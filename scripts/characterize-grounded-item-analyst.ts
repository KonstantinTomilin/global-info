/**
 * C2 offline characterize — recorded fixtures, NETWORK_CALLS=0.
 * Run: npx tsx scripts/characterize-grounded-item-analyst.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGroundedItemAnalyst } from "../src/modules/digital-profile/orion-golden/grounded-item-analyst/run-grounded-item-analyst";
import type { SourceContentIndex } from "../src/modules/digital-profile/orion-golden/contracts/source-content-index";
import type { RawInventoryItem } from "../src/modules/digital-profile/orion-golden/types";
import {
  CORRUPTION_FIXTURE_SOURCE,
  POLITICS_FIXTURE_SOURCE,
  recordedCorruptionDraft,
  recordedPoliticsDraft,
} from "../tests/fixtures/grounded-item-analyst/recorded-drafts";

process.env.NETWORK_CALLS = "0";

const OUT = join(process.cwd(), "tmp-pdf-review", "c2-grounded-item-analyst");

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const subjectA = {
    subjectId: "case-a",
    displayName: "Иван Тестов",
    aliases: ["Testov"],
  };
  const subjectB = {
    subjectId: "case-b",
    displayName: "Пётр Примерный",
    aliases: ["Primerov"],
  };

  const entries: SourceContentIndex["entries"] = [
    {
      evidenceRef: "inventory:c",
      inventoryId: "c",
      url: "https://news.example/corruption",
      selectionTier: "KEEP_PRIMARY",
      findingIds: ["f1"],
      contentSource: "full_text",
      fetchStatus: "fetched",
      fetchedAt: new Date().toISOString(),
      extractedTitle: "Investigation",
      extractedLang: "en",
      sourceDate: null,
      extractedText: CORRUPTION_FIXTURE_SOURCE,
      contentHash: "c-hash",
      storageRef: null,
      notEligibleAsAdverseExample: false,
      networkCalls: 0,
    },
    {
      evidenceRef: "inventory:p",
      inventoryId: "p",
      url: "https://news.example/politics",
      selectionTier: "KEEP_SUPPORTING",
      findingIds: ["f2"],
      contentSource: "full_text",
      fetchStatus: "fetched",
      fetchedAt: new Date().toISOString(),
      extractedTitle: "Politics",
      extractedLang: "en",
      sourceDate: null,
      extractedText: POLITICS_FIXTURE_SOURCE,
      contentHash: "p-hash",
      storageRef: null,
      notEligibleAsAdverseExample: false,
      networkCalls: 0,
    },
    {
      evidenceRef: "inventory:s",
      inventoryId: "s",
      url: "https://news.example/snip",
      selectionTier: "KEEP_PRIMARY",
      findingIds: ["f3"],
      contentSource: "snippet_only",
      fetchStatus: "offline",
      fetchedAt: new Date().toISOString(),
      extractedTitle: "Snippet title",
      extractedLang: null,
      sourceDate: null,
      extractedText: "Snippet title",
      contentHash: null,
      storageRef: null,
      notEligibleAsAdverseExample: false,
      networkCalls: 0,
    },
  ];

  const index: SourceContentIndex = {
    schemaVersion: "source-content-index-v1",
    caseId: "case-a",
    datasetId: "ds-a",
    generatedAt: new Date().toISOString(),
    entries,
    coverage: {
      selected: 3,
      fullText: 2,
      snippetOnly: 1,
      unavailable: 0,
      skippedNonArticle: 0,
      primarySupportingSelected: 3,
      primarySupportingFullText: 2,
      PRIMARY_SUPPORTING_CONTENT_COVERAGE: 2 / 3,
      SILENT_DROPS_ON_FETCH: 0,
      networkCallsTotal: 0,
    },
  };

  const items: RawInventoryItem[] = entries.map((e) => ({
    inventoryId: e.inventoryId,
    caseId: "case-a",
    reportRunId: "r",
    source: "web",
    provider: "serper",
    region: "RU",
    collectedAt: "2026-01-01T00:00:00Z",
    evidenceType: "serp",
    title: e.extractedTitle ?? e.url,
    sourceUrl: e.url,
  }));

  const workA = join(OUT, "a");
  const bundleA = await runGroundedItemAnalyst({
    caseId: "case-a",
    datasetId: "ds-a",
    artifactsDir: workA,
    sourceContent: index,
    items,
    findings: [],
    subject: subjectA,
    caller: async (args) => {
      const url = String((args.userPayload as { item?: { url?: string } })?.item?.url ?? "");
      if (url.includes("politics")) return recordedPoliticsDraft(subjectA.displayName);
      if (url.includes("snip")) {
        return {
          clientDescription:
            "По открытым источникам найдена публикация «Snippet title». Содержание материала автоматически раскрыть не удалось.",
          claimKind: "CONTEXT",
          attribution: null,
          whyItMatters: "Нужна ручная проверка первоисточника.",
          qualification: "Сниппет не является доказанным фактом.",
          recommendedChecks: ["Открыть первоисточник"],
          entities: [subjectA.displayName],
          dates: [],
          regions: [],
          supportingSpans: [{ sentenceIndex: 0, quote: "Snippet title" }, { sentenceIndex: 1, quote: "Snippet title" }],
          analysisConfidence: 0.4,
        };
      }
      return recordedCorruptionDraft(subjectA.displayName);
    },
  });

  const workB = join(OUT, "b");
  const bundleB = await runGroundedItemAnalyst({
    caseId: "case-b",
    datasetId: "ds-b",
    artifactsDir: workB,
    sourceContent: { ...index, caseId: "case-b", datasetId: "ds-b" },
    items: items.map((i) => ({ ...i, caseId: "case-b" })),
    findings: [],
    subject: subjectB,
    caller: async () => recordedPoliticsDraft(subjectB.displayName),
    universalityPeerAnalyses: bundleA.analyses,
  });

  const report = {
    version: "c2-grounded-item-analyst-characterize-v1",
    at: new Date().toISOString(),
    CEO_READY: false,
    gates: {
      GROUNDED_SENTENCE_RATIO: bundleA.groundingReport.GROUNDED_SENTENCE_RATIO,
      HALLUCINATED_ENTITIES: bundleA.groundingReport.HALLUCINATED_ENTITIES,
      UNQUALIFIED_MEDIA_ALLEGATIONS:
        bundleA.groundingReport.UNQUALIFIED_MEDIA_ALLEGATIONS,
      EMPTY_OR_SILENT_DROP: bundleA.groundingReport.EMPTY_OR_SILENT_DROP,
      SUBJECT_UNIVERSALITY_PASS: bundleB.groundingReport.SUBJECT_UNIVERSALITY_PASS,
    },
    groundingReport: bundleA.groundingReport,
    fallbackReport: bundleA.fallbackReport,
    PASS:
      bundleA.groundingReport.GROUNDED_SENTENCE_RATIO >= 0.99 &&
      bundleA.groundingReport.HALLUCINATED_ENTITIES === 0 &&
      bundleA.groundingReport.UNQUALIFIED_MEDIA_ALLEGATIONS === 0 &&
      bundleA.groundingReport.EMPTY_OR_SILENT_DROP === 0 &&
      bundleB.groundingReport.SUBJECT_UNIVERSALITY_PASS === true &&
      bundleA.analyses.length === 3,
  };

  writeFileSync(join(OUT, "c2-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.PASS) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
