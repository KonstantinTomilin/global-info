import { describe, expect, it } from "vitest";
import { buildCanonicalClaims } from "../../src/modules/digital-profile/orion-golden/analytics/canonical-claim-builder";
import type { ItemAnalysisBundle } from "../../src/modules/digital-profile/orion-golden/contracts/item-analysis";
import type { Finding } from "../../src/modules/digital-profile/orion-golden/contracts/finding";
import {
  ITEM_ANALYSIS_SCHEMA_VERSION,
  GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
} from "../../src/modules/digital-profile/orion-golden/contracts/item-analysis";

function analysis(partial: {
  evidenceRef: string;
  inventoryId: string;
  clientDescription: string;
}): ItemAnalysisBundle["analyses"][number] {
  return {
    schemaVersion: ITEM_ANALYSIS_SCHEMA_VERSION,
    evidenceRef: partial.evidenceRef,
    inventoryId: partial.inventoryId,
    url: `https://news.example/${partial.inventoryId}`,
    contentSource: "full_text",
    contentHash: "h1",
    promptVersion: GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
    clientDescription: partial.clientDescription,
    claimKind: "SOURCE_ALLEGATION",
    attribution: "сообщается",
    whyItMatters: "Важно для compliance.",
    qualification:
      "Наличие публикации не подтверждает изложенные утверждения; требуется проверка.",
    recommendedChecks: ["Проверить первоисточник"],
    entities: [],
    dates: [],
    regions: [],
    supportingSpans: [{ sentenceIndex: 0, quote: "conflict of interest" }],
    analysisConfidence: 0.8,
    producedBy: "llm",
    groundingOk: true,
    guardNotes: [],
  };
}

function finding(partial: Partial<Finding> & Pick<Finding, "findingId" | "theme" | "evidenceRefs">): Finding {
  return {
    schemaVersion: "finding-v2",
    caseId: "c",
    datasetId: "d",
    sourceHashes: [],
    claim: "claim",
    subjectMatch: "SUBJECT_MATCH",
    riskLevel: "high",
    confidence: 0.9,
    regions: ["RU"],
    sourceDomains: ["news.example"],
    providers: ["serper"],
    recommendedAction: "review",
    contradictions: [],
    limitations: [],
    promotionPriority: "P1",
    ...partial,
  };
}

describe("C3 canonical-claim-builder", () => {
  it("sets displayExcerpt = full clientDescription (no truncation)", () => {
    const long =
      "В материале сообщается о расследовании. Авторы утверждают конфликт интересов и коррупционный риск. Требуется проверка первичных документов без превращения публикации в установленный факт.";
    const bundle: ItemAnalysisBundle = {
      schemaVersion: "item-analysis-bundle-v1",
      caseId: "c",
      datasetId: "d",
      promptVersion: GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      analyses: [analysis({ evidenceRef: "inventory:1", inventoryId: "1", clientDescription: long })],
      groundingReport: {
        analyzed: 1,
        groundedSentenceRatio: 1,
        HALLUCINATED_ENTITIES: 0,
        UNQUALIFIED_MEDIA_ALLEGATIONS: 0,
        EMPTY_OR_SILENT_DROP: 0,
        GROUNDED_SENTENCE_RATIO: 1,
        fallbackCount: 0,
        llmCount: 1,
        SUBJECT_UNIVERSALITY_PASS: true,
      },
      fallbackReport: { count: 0, reasons: [] },
    };
    const findings = [
      finding({
        findingId: "f1",
        theme: "criminal_legal",
        evidenceRefs: ["inventory:1"],
      }),
    ];
    const claims = buildCanonicalClaims({
      caseId: "c",
      datasetId: "d",
      itemAnalysis: bundle,
      findings,
    });
    expect(claims.gates.SEMANTIC_EXCERPT_TRUNCATIONS).toBe(0);
    expect(claims.claims[0].displayExcerpt).toBe(long);
    expect(claims.claims[0].displayExcerpt).toBe(claims.claims[0].clientDescription);
    expect(claims.claims[0].qualification.length).toBeGreaterThan(10);
    expect(claims.claims[0].evidenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(claims.claims[0].isAdverseTheme).toBe(true);
    expect(claims.gates.ADVERSE_GROUNDED_COVERAGE).toBe(1);
  });

  it("resolves Finding.theme label to themeId for adverse coverage", () => {
    const bundle: ItemAnalysisBundle = {
      schemaVersion: "item-analysis-bundle-v1",
      caseId: "c",
      datasetId: "d",
      promptVersion: GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      analyses: [
        analysis({
          evidenceRef: "inventory:2",
          inventoryId: "2",
          clientDescription: "Краткий заземлённый пересказ судебного сюжета для проверки.",
        }),
      ],
      groundingReport: {
        analyzed: 1,
        groundedSentenceRatio: 1,
        HALLUCINATED_ENTITIES: 0,
        UNQUALIFIED_MEDIA_ALLEGATIONS: 0,
        EMPTY_OR_SILENT_DROP: 0,
        GROUNDED_SENTENCE_RATIO: 1,
        fallbackCount: 0,
        llmCount: 1,
        SUBJECT_UNIVERSALITY_PASS: true,
      },
      fallbackReport: { count: 0, reasons: [] },
    };
    const claims = buildCanonicalClaims({
      caseId: "c",
      datasetId: "d",
      itemAnalysis: bundle,
      findings: [
        finding({
          findingId: "f2",
          theme: "Криминальные / судебные материалы",
          evidenceRefs: ["inventory:2"],
        }),
      ],
    });
    expect(claims.claims[0].theme).toBe("criminal_legal");
    expect(claims.claims[0].isAdverseTheme).toBe(true);
    expect(claims.gates.ADVERSE_GROUNDED_COVERAGE).toBe(1);
  });
});
