import { describe, expect, it } from "vitest";
import {
  assertComposedSummaryGatesPass,
  composeClientSummary,
} from "../../src/modules/digital-profile/orion-golden/analytics/client-summary-composer";
import {
  assertContentQualityGatesPass,
  evaluateContentQuality,
} from "../../src/modules/digital-profile/orion-golden/deck-sections/content-quality-harness";
import type { CanonicalClaimBundle } from "../../src/modules/digital-profile/orion-golden/contracts/canonical-claim";
import { CANONICAL_CLAIM_SCHEMA_VERSION } from "../../src/modules/digital-profile/orion-golden/contracts/canonical-claim";
import type { Finding } from "../../src/modules/digital-profile/orion-golden/contracts/finding";
import type { SectionPackV2 } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";
import { SECTION_PACK_SCHEMA_VERSION } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";

process.env.NETWORK_CALLS = "0";

function claim(partial: {
  claimId: string;
  theme: string;
  clientDescription: string;
  whyItMatters: string;
  quote?: string;
  inventoryId?: string;
}): CanonicalClaimBundle["claims"][number] {
  const desc = partial.clientDescription;
  const quote = partial.quote ?? "расследование";
  return {
    schemaVersion: CANONICAL_CLAIM_SCHEMA_VERSION,
    claimId: partial.claimId,
    evidenceRefs: [`inventory:${partial.inventoryId ?? partial.claimId}`],
    inventoryId: partial.inventoryId ?? partial.claimId,
    url: `https://news.example/${partial.claimId}`,
    theme: partial.theme,
    isAdverseTheme: true,
    riskLevel: "high",
    clientDescription: desc,
    displayExcerpt: desc,
    claimKind: "SOURCE_ALLEGATION",
    attribution: "сообщается",
    qualification:
      "Наличие публикации не подтверждает изложенные утверждения; требуется проверка.",
    recommendedChecks: ["Сверить первоисточник"],
    whyItMatters: partial.whyItMatters,
    supportingSpans: [{ sentenceIndex: 0, quote }],
    contentSource: "full_text",
    originalFullTextRef: null,
    contentHash: "h1",
    findingIds: [`finding-${partial.claimId}`],
    semanticExcerptTruncations: 0,
  };
}

function claimsBundle(claims: CanonicalClaimBundle["claims"]): CanonicalClaimBundle {
  return {
    schemaVersion: "canonical-claims-v1",
    caseId: "case-c8",
    datasetId: "ds-c8",
    generatedAt: new Date().toISOString(),
    claims,
    gates: {
      SEMANTIC_EXCERPT_TRUNCATIONS: 0,
      adverseClaims: claims.length,
      adverseWithGroundedDescription: claims.length,
      ADVERSE_GROUNDED_COVERAGE: 1,
    },
  };
}

function finding(partial: Partial<Finding> & Pick<Finding, "findingId" | "theme">): Finding {
  return {
    schemaVersion: "finding-v2",
    caseId: "case-c8",
    datasetId: "ds-c8",
    sourceHashes: [],
    evidenceRefs: ["inventory:a1"],
    claim: "composed claim",
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

function themePack(bullets: string[]): SectionPackV2 {
  return {
    schemaVersion: SECTION_PACK_SCHEMA_VERSION,
    caseId: "case-c8",
    datasetId: "ds-c8",
    reportRunId: "run-1",
    fragmentKey: "RU_SUMMARY",
    sectionType: "RU_PROFILE",
    status: "READY",
    inputHash: "ih",
    contentHash: "ch",
    promptVersion: "pv",
    slides: [
      {
        schemaVersion: "slide-content-v1",
        slideId: "ru-summary-main",
        sectionType: "RU",
        templateId: "regional-summary",
        title: "Резюме",
        content: { bullets, narrative: "Короткий вывод." },
        evidenceRefs: [],
        findingIds: [],
      },
    ],
    validation: { passed: true, issues: [] },
  } as SectionPackV2;
}

describe("C8 content-quality-harness", () => {
  it("passes deterministic gates on grounded composed summary + clean section packs", () => {
    const canonical = claimsBundle([
      claim({
        claimId: "a1",
        theme: "criminal_legal",
        clientDescription:
          "Авторы расследования описывают обстоятельства совместного отдыха и возможный конфликт интересов.",
        whyItMatters:
          "Такой сюжет обычно запускает расширенную проверку контрагента и запрос первичных документов.",
        quote: "Авторы расследования описывают",
      }),
    ]);
    const summary = composeClientSummary({
      caseId: "case-c8",
      datasetId: "ds-c8",
      claims: canonical,
    });
    assertComposedSummaryGatesPass(summary);

    const pack = themePack([
      summary.mediaThemeBlocks[0]!.articles[0]!.body +
        "\n\nПочему важно: " +
        summary.mediaThemeBlocks[0]!.whyItMatters,
    ]);

    const report = evaluateContentQuality({
      caseId: "case-c8",
      datasetId: "ds-c8",
      packs: [pack],
      findings: [
        finding({
          findingId: "finding-criminal",
          theme: "criminal_legal",
          riskLevel: "high",
        }),
      ],
      composedClientSummary: summary,
      canonicalClaims: canonical,
      sourceTextByEvidenceRef: {
        "inventory:a1":
          "Авторы расследования описывают обстоятельства совместного отдыха и возможный конфликт интересов.",
      },
      allowedProfileTokens: ["Subject Alpha"],
    });

    expect(report.CEO_READY).toBe(false);
    expect(report.gates.CRITICAL_HIGH_THEME_COVERAGE).toBe(1);
    expect(report.gates.UNGROUNDED_CLIENT_SENTENCES).toBe(0);
    expect(report.gates.CLIENT_TECHNICAL_TOKENS).toBe(0);
    expect(report.deterministicPass).toBe(true);
    assertContentQualityGatesPass(report);
  });

  it("flags ungrounded client sentences when spans miss source text", () => {
    const canonical = claimsBundle([
      claim({
        claimId: "bad",
        theme: "criminal_legal",
        clientDescription: "Выдуманное утверждение без опоры в первоисточнике.",
        whyItMatters: "Проверка grounding gate.",
        quote: "missing-in-source",
      }),
    ]);
    const summary = composeClientSummary({
      caseId: "case-c8",
      datasetId: "ds-c8",
      claims: canonical,
      materialThemeKeys: ["criminal_legal"],
    });

    const report = evaluateContentQuality({
      caseId: "case-c8",
      packs: [themePack([summary.mediaThemeBlocks[0]!.articles[0]!.body])],
      findings: [
        finding({ findingId: "f1", theme: "criminal_legal", riskLevel: "critical" }),
      ],
      composedClientSummary: summary,
      canonicalClaims: canonical,
      sourceTextByEvidenceRef: {
        "inventory:bad": "Совсем другой текст источника без совпадений.",
      },
    });

    expect(report.gates.UNGROUNDED_CLIENT_SENTENCES).toBeGreaterThan(0);
    expect(report.deterministicPass).toBe(false);
    expect(() => assertContentQualityGatesPass(report)).toThrow(/UNGROUNDED_CLIENT_SENTENCES/);
  });

  it("flags junk appendix refs used as adverse examples", () => {
    const canonical = claimsBundle([
      claim({
        claimId: "ok",
        theme: "criminal_legal",
        clientDescription:
          "Содержательный пересказ расследования с именами, обстоятельствами и риском конфликта.",
        whyItMatters: "Конкретный why для криминально-судебной темы.",
        quote: "Содержательный пересказ расследования",
        inventoryId: "ok",
      }),
    ]);
    const summary = composeClientSummary({
      caseId: "case-c8",
      datasetId: "ds-c8",
      claims: canonical,
    });
    summary.mediaThemeBlocks[0]!.articles.push({
      ...summary.mediaThemeBlocks[0]!.articles[0]!,
      evidenceRef: "inventory:junk",
      domain: "youtube.com",
      body:
        "В материале youtube.com сообщается: meme title 😂 organized crime group, officials, girls.\n\n" +
        "Источник: youtube.com. Наличие публикации не подтверждает утверждения.",
      claimId: "junk-claim",
    });

    const report = evaluateContentQuality({
      caseId: "case-c8",
      packs: [themePack([])],
      composedClientSummary: summary,
      canonicalClaims: canonical,
      excludeEvidenceRefs: ["inventory:junk"],
      sourceTextByEvidenceRef: {
        "inventory:ok":
          "Содержательный пересказ расследования с именами, обстоятельствами и риском конфликта.",
      },
    });

    expect(report.gates.JUNK_ADVERSE_EXAMPLES).toBeGreaterThan(0);
    expect(() => assertContentQualityGatesPass(report)).toThrow(/JUNK_ADVERSE_EXAMPLES/);
  });

  it("flags technical tokens in section pack client text", () => {
    const report = evaluateContentQuality({
      caseId: "case-c8",
      packs: [
        themePack([
          "Тема с техническим маркером inventory:secret-ref и finding-abc-123 в клиентском тексте.",
        ]),
      ],
    });

    expect(report.gates.CLIENT_TECHNICAL_TOKENS).toBeGreaterThan(0);
    expect(report.CEO_READY).toBe(false);
    expect(() => assertContentQualityGatesPass(report)).toThrow(/CLIENT_TECHNICAL_TOKENS/);
  });

  it("ignores QA-only [finding-…] markers and domain hosts in CLIENT_TECHNICAL_TOKENS", () => {
    const report = evaluateContentQuality({
      caseId: "case-c8",
      packs: [
        themePack([
          "По региону «Россия»: тема подтверждена на audit-it.ru и reuters.com. [finding-criminal-1]",
          "Ключевой материал: kommersant.ru — сверить первоисточник. [finding-criminal-2]",
        ]),
      ],
    });
    expect(report.gates.CLIENT_TECHNICAL_TOKENS).toBe(0);
  });
});
