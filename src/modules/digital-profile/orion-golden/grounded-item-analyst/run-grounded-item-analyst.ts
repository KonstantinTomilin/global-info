/**
 * C2 — Run GroundedItemAnalyst over SourceContentIndex entries.
 * Never silently drops: every selected entry gets an ItemAnalysis (fallback if needed).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../contracts/finding";
import {
  GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
  type ItemAnalysis,
  type ItemAnalysisBundle,
} from "../contracts/item-analysis";
import type { SourceContentIndex } from "../contracts/source-content-index";
import type { RawInventoryItem } from "../types";
import type { GptJsonCaller } from "../gpt/gpt-case-analysis";
import { analyzeItem } from "./analyze-item";
import {
  readItemAnalysisCache,
  writeItemAnalysisCache,
} from "./item-analysis-cache";
import { splitSentences, validateItemAnalysisGrounding } from "./grounding-guards";

export type GroundedItemAnalystInput = {
  caseId: string;
  datasetId: string;
  artifactsDir: string;
  sourceContent: SourceContentIndex;
  items: RawInventoryItem[];
  findings: Finding[];
  subject: {
    subjectId: string;
    displayName: string;
    aliases: string[];
    contextIdentifiers?: string[];
  };
  /** Injectable LLM caller; null/omit → deterministic path only. */
  caller?: GptJsonCaller | null;
  /**
   * When true, assert that subject B never receives facts from subject A's
   * recorded analyses (test hook).
   */
  universalityPeerAnalyses?: ItemAnalysis[];
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function themeForEntry(
  findingIds: string[],
  findings: Finding[]
): string | undefined {
  const set = new Set(findingIds);
  const hit = findings.find((f) => set.has(f.findingId));
  return hit?.theme;
}

function sourceTextFor(entry: SourceContentIndex["entries"][number], item?: RawInventoryItem): string {
  if (entry.contentSource === "full_text" && entry.extractedText?.trim()) {
    return entry.extractedText.trim();
  }
  const parts = [
    entry.extractedTitle ?? item?.title ?? "",
    entry.extractedText ?? item?.snippet ?? "",
  ];
  return parts.map((p) => p.trim()).filter(Boolean).join("\n");
}

export async function runGroundedItemAnalyst(
  input: GroundedItemAnalystInput
): Promise<ItemAnalysisBundle> {
  const byId = new Map(input.items.map((i) => [i.inventoryId, i]));
  const analyses: ItemAnalysis[] = [];
  const fallbackReasons: string[] = [];
  let hallucinatedTotal = 0;
  let unqualifiedAllegations = 0;
  let groundedSentences = 0;
  let totalSentences = 0;
  let llmCount = 0;
  let fallbackCount = 0;

  for (const entry of input.sourceContent.entries) {
    const item = byId.get(entry.inventoryId);
    const sourceText = sourceTextFor(entry, item);
    const title = entry.extractedTitle ?? item?.title ?? entry.url;

    const cacheHit = readItemAnalysisCache(input.artifactsDir, {
      contentHash: entry.contentHash,
      url: entry.url,
      subjectId: input.subject.subjectId,
    });
    if (cacheHit) {
      analyses.push(cacheHit);
      const sents = splitSentences(cacheHit.clientDescription);
      totalSentences += sents.length;
      groundedSentences += sents.length;
      continue;
    }

    const analysis = await analyzeItem({
      evidenceRef: entry.evidenceRef,
      inventoryId: entry.inventoryId,
      url: entry.url,
      title,
      sourceText: sourceText || title,
      contentSource: entry.contentSource,
      contentHash: entry.contentHash,
      domain: domainOf(entry.url),
      sourceDate: entry.sourceDate,
      extractedLang: entry.extractedLang,
      theme: themeForEntry(entry.findingIds, input.findings),
      subject: input.subject,
      caller: input.caller,
    });

    // Guarantee non-empty (EMPTY_OR_SILENT_DROP=0).
    if (!analysis.clientDescription.trim()) {
      throw new Error(`EMPTY_OR_SILENT_DROP for ${entry.evidenceRef}`);
    }

    const guard = validateItemAnalysisGrounding({
      clientDescription: analysis.clientDescription,
      claimKind: analysis.claimKind,
      attribution: analysis.attribution,
      supportingSpans: analysis.supportingSpans,
      sourceText: sourceText || title,
      allowedProfileTokens: [
        input.subject.displayName,
        ...input.subject.aliases,
        ...(input.subject.contextIdentifiers ?? []),
        domainOf(entry.url),
      ],
      contentSource: entry.contentSource,
      entities: analysis.entities,
    });

    hallucinatedTotal += guard.hallucinatedEntities.length;
    if (guard.issues.some((i) => i.code === "UNQUALIFIED_ALLEGATION")) {
      unqualifiedAllegations += 1;
    }
    const sents = splitSentences(analysis.clientDescription);
    totalSentences += sents.length;
    groundedSentences += Math.round(guard.groundedSentenceRatio * sents.length);

    if (analysis.producedBy === "deterministic_fallback") {
      fallbackCount += 1;
      fallbackReasons.push(
        ...analysis.guardNotes.filter((n) => n.includes("fallback") || n.includes("llm_error"))
      );
    } else if (analysis.producedBy === "llm" || analysis.producedBy === "llm_repaired") {
      llmCount += 1;
    }

    writeItemAnalysisCache(
      input.artifactsDir,
      {
        contentHash: entry.contentHash,
        url: entry.url,
        subjectId: input.subject.subjectId,
      },
      analysis
    );
    analyses.push(analysis);
  }

  if (analyses.length !== input.sourceContent.entries.length) {
    throw new Error(
      `EMPTY_OR_SILENT_DROP: entries=${input.sourceContent.entries.length} analyses=${analyses.length}`
    );
  }

  // Universality: peer analyses must not leak into this subject's outputs.
  let subjectUniversalityPass = true;
  if (input.universalityPeerAnalyses?.length) {
    const peerFingerprints = input.universalityPeerAnalyses.map((a) =>
      a.clientDescription.slice(0, 80)
    );
    for (const a of analyses) {
      for (const fp of peerFingerprints) {
        if (fp && a.clientDescription.includes(fp) && fp.length > 40) {
          subjectUniversalityPass = false;
        }
      }
    }
  }

  const groundedRatio = totalSentences > 0 ? groundedSentences / totalSentences : 1;

  const bundle: ItemAnalysisBundle = {
    schemaVersion: "item-analysis-bundle-v1",
    caseId: input.caseId,
    datasetId: input.datasetId,
    promptVersion: GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    analyses,
    groundingReport: {
      analyzed: analyses.length,
      groundedSentenceRatio: groundedRatio,
      HALLUCINATED_ENTITIES: hallucinatedTotal,
      UNQUALIFIED_MEDIA_ALLEGATIONS: unqualifiedAllegations,
      EMPTY_OR_SILENT_DROP: 0,
      GROUNDED_SENTENCE_RATIO: groundedRatio,
      fallbackCount,
      llmCount,
      SUBJECT_UNIVERSALITY_PASS: subjectUniversalityPass,
    },
    fallbackReport: {
      count: fallbackCount,
      reasons: [...new Set(fallbackReasons)].slice(0, 40),
    },
  };

  mkdirSync(input.artifactsDir, { recursive: true });
  writeFileSync(
    join(input.artifactsDir, "item-analysis.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(input.artifactsDir, "grounding-report.json"),
    `${JSON.stringify(bundle.groundingReport, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(input.artifactsDir, "fallback-report.json"),
    `${JSON.stringify(bundle.fallbackReport, null, 2)}\n`,
    "utf8"
  );

  return bundle;
}
