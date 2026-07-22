import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeItem } from "../../src/modules/digital-profile/orion-golden/grounded-item-analyst/analyze-item";
import { validateItemAnalysisGrounding } from "../../src/modules/digital-profile/orion-golden/grounded-item-analyst/grounding-guards";
import { runGroundedItemAnalyst } from "../../src/modules/digital-profile/orion-golden/grounded-item-analyst/run-grounded-item-analyst";
import type { SourceContentIndex } from "../../src/modules/digital-profile/orion-golden/contracts/source-content-index";
import type { Finding } from "../../src/modules/digital-profile/orion-golden/contracts/finding";
import type { RawInventoryItem } from "../../src/modules/digital-profile/orion-golden/types";
import {
  CORRUPTION_FIXTURE_SOURCE,
  POLITICS_FIXTURE_SOURCE,
  recordedCorruptionDraft,
  recordedHallucinatedDraft,
  recordedPoliticsDraft,
} from "../fixtures/grounded-item-analyst/recorded-drafts";

const SUBJECT_A = {
  subjectId: "case-a",
  displayName: "Иван Тестов",
  aliases: ["Testov Ivan"],
  contextIdentifiers: ["UAE"],
};

const SUBJECT_B = {
  subjectId: "case-b",
  displayName: "Пётр Примерный",
  aliases: ["Primerov Petr"],
};

function baseSourceIndex(entries: SourceContentIndex["entries"]): SourceContentIndex {
  return {
    schemaVersion: "source-content-index-v1",
    caseId: "case-a",
    datasetId: "ds-a",
    generatedAt: new Date().toISOString(),
    entries,
    coverage: {
      selected: entries.length,
      fullText: entries.filter((e) => e.contentSource === "full_text").length,
      snippetOnly: entries.filter((e) => e.contentSource === "snippet_only").length,
      unavailable: 0,
      skippedNonArticle: 0,
      primarySupportingSelected: entries.length,
      primarySupportingFullText: entries.filter((e) => e.contentSource === "full_text").length,
      PRIMARY_SUPPORTING_CONTENT_COVERAGE: 1,
      SILENT_DROPS_ON_FETCH: 0,
      networkCallsTotal: 0,
    },
  };
}

describe("C2 grounding guards", () => {
  it("rejects hallucinated entities", () => {
    const draft = recordedHallucinatedDraft();
    const guard = validateItemAnalysisGrounding({
      clientDescription: draft.clientDescription,
      claimKind: draft.claimKind,
      attribution: draft.attribution,
      supportingSpans: draft.supportingSpans,
      sourceText: CORRUPTION_FIXTURE_SOURCE,
      allowedProfileTokens: [SUBJECT_A.displayName],
      contentSource: "full_text",
      entities: draft.entities,
    });
    expect(guard.ok).toBe(false);
    expect(guard.hallucinatedEntities.length).toBeGreaterThan(0);
  });

  it("rejects unqualified SOURCE_ALLEGATION", () => {
    const guard = validateItemAnalysisGrounding({
      clientDescription: "Субъект связан с коррупцией.",
      claimKind: "SOURCE_ALLEGATION",
      attribution: null,
      supportingSpans: [
        { sentenceIndex: 0, quote: "conflict of interest and a corruption risk" },
      ],
      sourceText: CORRUPTION_FIXTURE_SOURCE,
      allowedProfileTokens: [],
      contentSource: "full_text",
    });
    expect(guard.issues.some((i) => i.code === "UNQUALIFIED_ALLEGATION")).toBe(true);
  });
});

describe("C2 analyzeItem (recorded)", () => {
  it("corruption-like fixture → attributed grounded description", async () => {
    const analysis = await analyzeItem({
      evidenceRef: "inventory:c1",
      inventoryId: "c1",
      url: "https://news.example/corruption",
      title: "Investigation fixture",
      sourceText: CORRUPTION_FIXTURE_SOURCE,
      contentSource: "full_text",
      contentHash: "hash-c",
      domain: "news.example",
      sourceDate: "2018-03-15",
      extractedLang: "en",
      subject: SUBJECT_A,
      caller: async () => recordedCorruptionDraft(SUBJECT_A.displayName),
    });
    expect(analysis.producedBy).toBe("llm");
    expect(analysis.groundingOk).toBe(true);
    expect(analysis.clientDescription.toLowerCase()).toMatch(/утвержд|сообщ/);
    expect(analysis.qualification.length).toBeGreaterThan(20);
    expect(analysis.supportingSpans.length).toBeGreaterThanOrEqual(2);
  });

  it("politics-like fixture → political exposure without corruption proof", async () => {
    const analysis = await analyzeItem({
      evidenceRef: "inventory:p1",
      inventoryId: "p1",
      url: "https://news.example/politics",
      title: "Politics fixture",
      sourceText: POLITICS_FIXTURE_SOURCE,
      contentSource: "full_text",
      contentHash: "hash-p",
      domain: "news.example",
      sourceDate: null,
      extractedLang: "en",
      subject: SUBJECT_A,
      caller: async () => recordedPoliticsDraft(SUBJECT_A.displayName),
    });
    expect(analysis.groundingOk).toBe(true);
    expect(analysis.clientDescription.toLowerCase()).not.toMatch(/доказано/);
    expect(analysis.clientDescription.toLowerCase()).toMatch(/политич|fundraising|встреч/);
  });

  it("hallucinated entity → reject → repair/fallback non-empty", async () => {
    let calls = 0;
    const analysis = await analyzeItem({
      evidenceRef: "inventory:h1",
      inventoryId: "h1",
      url: "https://news.example/bad",
      title: "Bad",
      sourceText: CORRUPTION_FIXTURE_SOURCE,
      contentSource: "full_text",
      contentHash: "hash-h",
      domain: "news.example",
      sourceDate: null,
      extractedLang: "en",
      subject: SUBJECT_A,
      caller: async () => {
        calls += 1;
        if (calls === 1) return recordedHallucinatedDraft();
        // Repair still bad → fallback
        return recordedHallucinatedDraft();
      },
    });
    expect(calls).toBe(2);
    expect(analysis.producedBy).toBe("deterministic_fallback");
    expect(analysis.clientDescription.trim().length).toBeGreaterThan(0);
    expect(analysis.clientDescription).not.toMatch(/Atlantis Nova Holdings/);
  });

  it("allegation without attribution → repair can fix", async () => {
    let calls = 0;
    const analysis = await analyzeItem({
      evidenceRef: "inventory:a1",
      inventoryId: "a1",
      url: "https://news.example/a",
      title: "A",
      sourceText: CORRUPTION_FIXTURE_SOURCE,
      contentSource: "full_text",
      contentHash: "hash-a",
      domain: "news.example",
      sourceDate: null,
      extractedLang: "en",
      subject: SUBJECT_A,
      caller: async () => {
        calls += 1;
        if (calls === 1) {
          const d = recordedCorruptionDraft(SUBJECT_A.displayName);
          return { ...d, attribution: null, clientDescription: "Субъект связан с коррупционным риском." };
        }
        return recordedCorruptionDraft(SUBJECT_A.displayName);
      },
    });
    expect(calls).toBe(2);
    expect(analysis.producedBy).toBe("llm_repaired");
    expect(analysis.groundingOk).toBe(true);
  });

  it("snippet_only → honest short description without invention", async () => {
    const analysis = await analyzeItem({
      evidenceRef: "inventory:s1",
      inventoryId: "s1",
      url: "https://news.example/snip",
      title: "Short title only",
      sourceText: "Short title only\nserp snippet line",
      contentSource: "snippet_only",
      contentHash: null,
      domain: "news.example",
      sourceDate: null,
      extractedLang: null,
      subject: SUBJECT_A,
      caller: null,
    });
    expect(analysis.contentSource).toBe("snippet_only");
    expect(analysis.clientDescription.toLowerCase()).toMatch(/не удалось|сниппет|заголовок/);
    expect(analysis.clientDescription).not.toMatch(/Atlantis/);
  });
});

describe("C2 runGroundedItemAnalyst", () => {
  it("second subject does not receive first subject facts; cache stable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "c2-univ-"));
    try {
      const entries: SourceContentIndex["entries"] = [
        {
          evidenceRef: "inventory:1",
          inventoryId: "1",
          url: "https://news.example/c",
          selectionTier: "KEEP_PRIMARY",
          findingIds: ["f1"],
          contentSource: "full_text",
          fetchStatus: "fetched",
          fetchedAt: new Date().toISOString(),
          extractedTitle: "Investigation",
          extractedLang: "en",
          sourceDate: null,
          extractedText: CORRUPTION_FIXTURE_SOURCE,
          contentHash: "shared-hash",
          storageRef: null,
          notEligibleAsAdverseExample: false,
          networkCalls: 0,
        },
      ];
      const items: RawInventoryItem[] = [
        {
          inventoryId: "1",
          caseId: "case-a",
          reportRunId: "r",
          source: "web",
          provider: "serper",
          region: "RU",
          collectedAt: "2026-01-01T00:00:00Z",
          evidenceType: "serp",
          title: "Investigation",
          sourceUrl: "https://news.example/c",
        },
      ];
      const findings = [] as Finding[];

      const bundleA = await runGroundedItemAnalyst({
        caseId: "case-a",
        datasetId: "ds-a",
        artifactsDir: dir,
        sourceContent: baseSourceIndex(entries),
        items,
        findings,
        subject: SUBJECT_A,
        caller: async () => recordedCorruptionDraft(SUBJECT_A.displayName),
      });

      const bundleB = await runGroundedItemAnalyst({
        caseId: "case-b",
        datasetId: "ds-b",
        artifactsDir: join(dir, "b"),
        sourceContent: { ...baseSourceIndex(entries), caseId: "case-b", datasetId: "ds-b" },
        items: items.map((i) => ({ ...i, caseId: "case-b" })),
        findings,
        subject: SUBJECT_B,
        caller: async () => recordedPoliticsDraft(SUBJECT_B.displayName),
        universalityPeerAnalyses: bundleA.analyses,
      });

      expect(bundleA.groundingReport.EMPTY_OR_SILENT_DROP).toBe(0);
      expect(bundleA.groundingReport.HALLUCINATED_ENTITIES).toBe(0);
      expect(bundleA.groundingReport.GROUNDED_SENTENCE_RATIO).toBe(1);
      expect(bundleB.groundingReport.SUBJECT_UNIVERSALITY_PASS).toBe(true);
      expect(bundleB.analyses[0].clientDescription).not.toContain(SUBJECT_A.displayName);

      // Same input → cache hit (stable)
      const again = await runGroundedItemAnalyst({
        caseId: "case-a",
        datasetId: "ds-a",
        artifactsDir: dir,
        sourceContent: baseSourceIndex(entries),
        items,
        findings,
        subject: SUBJECT_A,
        caller: async () => {
          throw new Error("should use cache");
        },
      });
      expect(again.analyses[0].producedBy).toBe("cached");
      expect(again.analyses[0].clientDescription).toBe(bundleA.analyses[0].clientDescription);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
