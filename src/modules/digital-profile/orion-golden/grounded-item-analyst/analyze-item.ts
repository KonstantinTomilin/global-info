/**
 * C2 — Single-item grounded analysis (LLM + guards + repair + fallback).
 */

import {
  GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
  ITEM_ANALYSIS_SCHEMA_VERSION,
  ItemAnalysisSchema,
  type ClaimKind,
  type ItemAnalysis,
  type SupportingSpan,
} from "../contracts/item-analysis";
import type { ContentSource } from "../contracts/source-content-index";
import type { GptJsonCaller } from "../gpt/gpt-case-analysis";
import { buildDeterministicItemAnalysis } from "./deterministic-fallback";
import { validateItemAnalysisGrounding } from "./grounding-guards";

export type AnalyzeItemInput = {
  evidenceRef: string;
  inventoryId: string;
  url: string;
  title: string;
  sourceText: string;
  contentSource: ContentSource;
  contentHash: string | null;
  domain: string;
  sourceDate: string | null;
  extractedLang: string | null;
  theme?: string;
  subjectMatch?: string;
  confidence?: number;
  subject: {
    subjectId: string;
    displayName: string;
    aliases: string[];
    contextIdentifiers?: string[];
  };
  caller?: GptJsonCaller | null;
};

function profileTokens(subject: AnalyzeItemInput["subject"]): string[] {
  return [
    subject.displayName,
    ...subject.aliases,
    ...(subject.contextIdentifiers ?? []),
  ].filter(Boolean);
}

function systemPrompt(): string {
  return [
    "Ты аналитик due diligence. Пиши только на русском простым языком.",
    "Единственный источник фактов — переданный sourceText и профиль субъекта.",
    "Запрещено использовать общие знания о субъекте вне sourceText/профиля.",
    "Для медийных утверждений используй атрибуцию: утверждает/сообщается/связывает/по данным.",
    "Не подавай обвинения СМИ как установленный факт.",
    "Верни строго JSON по схеме ItemAnalysisDraft.",
  ].join(" ");
}

type LlmDraft = {
  clientDescription?: string;
  claimKind?: ClaimKind;
  attribution?: string | null;
  whyItMatters?: string;
  qualification?: string;
  recommendedChecks?: string[];
  entities?: string[];
  dates?: string[];
  regions?: string[];
  supportingSpans?: SupportingSpan[];
  analysisConfidence?: number;
};

function draftToAnalysis(
  input: AnalyzeItemInput,
  draft: LlmDraft,
  producedBy: ItemAnalysis["producedBy"],
  guardNotes: string[]
): ItemAnalysis {
  return ItemAnalysisSchema.parse({
    schemaVersion: ITEM_ANALYSIS_SCHEMA_VERSION,
    evidenceRef: input.evidenceRef,
    inventoryId: input.inventoryId,
    url: input.url,
    contentSource: input.contentSource,
    contentHash: input.contentHash,
    promptVersion: GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
    clientDescription: String(draft.clientDescription ?? "").trim(),
    claimKind: draft.claimKind ?? "SOURCE_ALLEGATION",
    attribution: draft.attribution ?? null,
    whyItMatters: String(draft.whyItMatters ?? "").trim(),
    qualification: String(draft.qualification ?? "").trim(),
    recommendedChecks: (draft.recommendedChecks ?? []).filter((x) => String(x).trim()),
    entities: draft.entities ?? [],
    dates: draft.dates ?? [],
    regions: draft.regions ?? [],
    supportingSpans: draft.supportingSpans ?? [],
    analysisConfidence:
      typeof draft.analysisConfidence === "number" ? draft.analysisConfidence : 0.5,
    producedBy,
    groundingOk: false,
    guardNotes,
  });
}

async function callDraft(
  caller: GptJsonCaller,
  input: AnalyzeItemInput,
  repairNotes?: string[]
): Promise<LlmDraft> {
  const userPayload = {
    task: repairNotes?.length ? "repair_item_analysis" : "analyze_item",
    promptVersion: GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
    repairNotes: repairNotes ?? [],
    subject: {
      displayName: input.subject.displayName,
      aliases: input.subject.aliases,
      contextIdentifiers: input.subject.contextIdentifiers ?? [],
    },
    item: {
      title: input.title,
      url: input.url,
      domain: input.domain,
      sourceDate: input.sourceDate,
      extractedLang: input.extractedLang,
      contentSource: input.contentSource,
      theme: input.theme,
      subjectMatch: input.subjectMatch,
      confidence: input.confidence,
      sourceText: input.sourceText,
    },
    outputSchema: {
      clientDescription: "2-4 Russian sentences",
      claimKind: "FACT|SOURCE_ALLEGATION|DATABASE_STATUS|OFFICIAL_RECORD|CONTEXT",
      attribution: "string|null",
      whyItMatters: "string",
      qualification: "string",
      recommendedChecks: ["string"],
      entities: ["string"],
      dates: ["string"],
      regions: ["string"],
      supportingSpans: [{ sentenceIndex: 0, quote: "verbatim from sourceText" }],
      analysisConfidence: 0.0,
    },
  };
  const parsed = (await caller({
    systemPrompt: systemPrompt(),
    userPayload,
  })) as LlmDraft;
  return parsed ?? {};
}

export async function analyzeItem(input: AnalyzeItemInput): Promise<ItemAnalysis> {
  const allowed = [...profileTokens(input.subject), input.domain].filter(Boolean);

  const finalize = (analysis: ItemAnalysis): ItemAnalysis => {
    const guard = validateItemAnalysisGrounding({
      clientDescription: analysis.clientDescription,
      claimKind: analysis.claimKind,
      attribution: analysis.attribution,
      supportingSpans: analysis.supportingSpans,
      sourceText: input.sourceText,
      allowedProfileTokens: allowed,
      contentSource: input.contentSource,
      entities: analysis.entities,
    });
    return {
      ...analysis,
      groundingOk: guard.ok,
      guardNotes: [
        ...analysis.guardNotes,
        ...guard.issues.map((i) => `${i.code}:${i.detail}`),
      ].slice(0, 30),
      analysisConfidence: guard.ok
        ? analysis.analysisConfidence
        : Math.min(analysis.analysisConfidence, 0.4),
    };
  };

  if (!input.caller) {
    return finalize(
      buildDeterministicItemAnalysis({
        evidenceRef: input.evidenceRef,
        inventoryId: input.inventoryId,
        url: input.url,
        title: input.title,
        sourceText: input.sourceText,
        contentSource: input.contentSource,
        contentHash: input.contentHash,
        theme: input.theme,
        subjectDisplayName: input.subject.displayName,
      })
    );
  }

  try {
    const draft = await callDraft(input.caller, input);
    let analysis = finalize(draftToAnalysis(input, draft, "llm", []));
    if (analysis.groundingOk) return analysis;

    // One repair pass on marked issues.
    const repairNotes = analysis.guardNotes.slice(0, 12);
    const repairedDraft = await callDraft(input.caller, input, repairNotes);
    analysis = finalize(draftToAnalysis(input, repairedDraft, "llm_repaired", repairNotes));
    if (analysis.groundingOk) return analysis;

    const fallback = finalize(
      buildDeterministicItemAnalysis({
        evidenceRef: input.evidenceRef,
        inventoryId: input.inventoryId,
        url: input.url,
        title: input.title,
        sourceText: input.sourceText,
        contentSource: input.contentSource,
        contentHash: input.contentHash,
        theme: input.theme,
        subjectDisplayName: input.subject.displayName,
      })
    );
    return {
      ...fallback,
      guardNotes: [...fallback.guardNotes, "fallback_after_guard_failure", ...repairNotes].slice(
        0,
        40
      ),
    };
  } catch (err) {
    const fallback = finalize(
      buildDeterministicItemAnalysis({
        evidenceRef: input.evidenceRef,
        inventoryId: input.inventoryId,
        url: input.url,
        title: input.title,
        sourceText: input.sourceText,
        contentSource: input.contentSource,
        contentHash: input.contentHash,
        theme: input.theme,
        subjectDisplayName: input.subject.displayName,
      })
    );
    return {
      ...fallback,
      guardNotes: [
        ...fallback.guardNotes,
        `llm_error:${err instanceof Error ? err.message : String(err)}`.slice(0, 160),
      ],
    };
  }
}
