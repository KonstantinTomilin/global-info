import { describe, expect, it } from "vitest";
import {
  assertDisclosurePlanGatesPass,
  buildCrossSlideDisclosurePlan,
} from "../../src/modules/digital-profile/orion-golden/analytics/cross-slide-disclosure-planner";
import {
  assertCrossSlideDedupeGatesPass,
  inspectCrossSlideDuplicateSentences,
} from "../../src/modules/digital-profile/orion-golden/deck-sections/cross-slide-dedupe-qa";
import { resolveDisclosureClaimText } from "../../src/modules/digital-profile/orion-golden/deck-sections/fragment-builders/shared";
import type { ComposedClientSummary } from "../../src/modules/digital-profile/orion-golden/contracts/composed-client-summary";
import type { Finding } from "../../src/modules/digital-profile/orion-golden/contracts/finding";
import type { SectionPackV2 } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";
import { COMPOSED_CLIENT_SUMMARY_VERSION } from "../../src/modules/digital-profile/orion-golden/contracts/composed-client-summary";

function finding(partial: Partial<Finding> & Pick<Finding, "findingId" | "theme">): Finding {
  return {
    schemaVersion: "finding-v2",
    caseId: "c",
    datasetId: "d",
    sourceHashes: [],
    evidenceRefs: ["inventory:1"],
    claim: "legacy full claim text that should not be copied everywhere",
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

function composed(): ComposedClientSummary {
  return {
    schemaVersion: COMPOSED_CLIENT_SUMMARY_VERSION,
    caseId: "c",
    datasetId: "d",
    generatedAt: new Date().toISOString(),
    mediaThemeBlocks: [
      {
        themeId: "criminal_legal",
        themeLabel: "Криминальные / судебные материалы",
        isAdverse: true,
        isDatabaseBlock: false,
        conclusion:
          "По открытым СМИ по теме «Криминальные / судебные материалы» выявлены существенные публикации (news.example).",
        articles: [
          {
            evidenceRef: "inventory:1",
            domain: "news.example",
            body: "В материале news.example сообщается: авторы описывают конфликт интересов и коррупционный риск.\n\nИсточник: news.example. Наличие публикации не подтверждает утверждения.",
            whyItMatters:
              "Такой сюжет обычно запускает расширенную проверку контрагента и запрос первичных документов.",
            qualification:
              "Наличие публикации не подтверждает изложенные утверждения; требуется проверка.",
            recommendedChecks: ["Сверить первоисточник"],
            claimId: "claim-1",
          },
        ],
        whyItMatters:
          "Такой сюжет обычно запускает расширенную проверку контрагента и запрос первичных документов.",
        recommendedChecks: ["Сверить первоисточник"],
        evidenceRefs: ["inventory:1"],
      },
    ],
    databaseThemeBlocks: [],
    gates: {
      SUMMARY_MATERIAL_THEME_COVERAGE: 1,
      SUMMARY_CONCRETE_EXAMPLES_PRESENT: true,
      PER_THEME_WHY_IS_ARTICLE_SPECIFIC: true,
      SUMMARY_UNSUPPORTED_ASSERTIONS: 0,
      SUMMARY_TECHNICAL_COPY_TOKENS: 0,
      SUMMARY_INCOMPLETE_SENTENCES: 0,
      materialThemeCount: 1,
      coveredMaterialThemeCount: 1,
    },
  };
}

describe("C6 cross-slide disclosure", () => {
  it("assigns exactly one full owner and distinct brief/matrix/surface texts", () => {
    const plan = buildCrossSlideDisclosurePlan({
      caseId: "c",
      datasetId: "d",
      composed: composed(),
      findings: [
        finding({
          findingId: "finding-criminal",
          theme: "Криминальные / судебные материалы",
          regions: ["RU"],
        }),
      ],
    });
    assertDisclosurePlanGatesPass(plan);
    expect(plan.materials).toHaveLength(1);
    const m = plan.materials[0]!;
    expect(m.fullOwnerFragment).toBe("RU_SUMMARY");
    expect(m.fullText.length).toBeGreaterThan(m.briefText.length);
    expect(m.briefText).not.toEqual(m.matrixText);
    expect(m.surfaceAngles.serp).not.toEqual(m.fullText);
    expect(m.surfaceAngles.images).not.toEqual(m.surfaceAngles.serp);

    const extras = { crossSlideDisclosurePlan: plan };
    const f = finding({
      findingId: "finding-criminal",
      theme: "Криминальные / судебные материалы",
    });
    expect(resolveDisclosureClaimText(f, "RU_SUMMARY", extras)).toBe(m.fullText);
    // Executive never carries fullText (section QA bullet budget).
    expect(resolveDisclosureClaimText(f, "EXECUTIVE_SUMMARY", extras)).toBe(m.briefText);
    expect(resolveDisclosureClaimText(f, "EXECUTIVE_SUMMARY", extras)).not.toBe(
      m.fullText
    );
    expect(resolveDisclosureClaimText(f, "RISK_MATRIX", extras)).toBe(m.matrixText);
    expect(resolveDisclosureClaimText(f, "RU_SERP", extras)).toBe(m.surfaceAngles.serp);
  });

  it("defaults full owner to RU_SUMMARY even without region tags", () => {
    const plan = buildCrossSlideDisclosurePlan({
      caseId: "c",
      datasetId: "d",
      composed: composed(),
      findings: [
        finding({
          findingId: "finding-criminal",
          theme: "Криминальные / судебные материалы",
          regions: [],
        }),
      ],
    });
    expect(plan.materials[0]!.fullOwnerFragment).toBe("RU_SUMMARY");
  });

  it("flags identical long sentences across fragments", () => {
    const dup =
      "По открытым СМИ выявлены существенные публикации по судебному сюжету, требующие проверки первичных документов немедленно.";
    const packs = [
      {
        fragmentKey: "EXECUTIVE_SUMMARY",
        slides: [{ content: { bullets: [dup] } }],
      },
      {
        fragmentKey: "RU_SUMMARY",
        slides: [{ content: { bullets: [dup] } }],
      },
    ] as unknown as SectionPackV2[];
    const report = inspectCrossSlideDuplicateSentences(packs);
    expect(report.CROSS_SLIDE_DUPLICATE_SENTENCES).toBeGreaterThanOrEqual(1);
    expect(() =>
      assertCrossSlideDedupeGatesPass({
        ...report,
        MATERIALS_WITHOUT_FULL_DISCLOSURE: 0,
        MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES: 0,
      })
    ).toThrow(/CROSS_SLIDE_DUPLICATE_SENTENCES/);
  });

  it("allows pagination continuations within the same fragment", () => {
    const sentence =
      "Полный абзац раскрытия материала остаётся только в региональном резюме и не должен копироваться на другие слайды отчёта.";
    const packs = [
      {
        fragmentKey: "RU_SUMMARY",
        slides: [
          { content: { bullets: [sentence] } },
          { content: { bullets: [sentence] } },
        ],
      },
    ] as unknown as SectionPackV2[];
    const report = inspectCrossSlideDuplicateSentences(packs);
    expect(report.CROSS_SLIDE_DUPLICATE_SENTENCES).toBe(0);
  });

  it("allows shared brief among overview/executive but not leak into RU_SUMMARY", () => {
    const brief =
      "В резюме зафиксирована тема «Криминальные / судебные материалы» (сигналы: echofm.online); полный разбор — в тематическом разделе.";
    const full =
      "По открытым СМИ по теме «Криминальные / судебные материалы» выявлены существенные публикации (echofm.online), требующие проверки первичных документов.";
    const sharedBriefPacks = [
      {
        fragmentKey: "DIGITAL_PROFILE_OVERVIEW",
        slides: [{ content: { bullets: [brief] } }],
      },
      {
        fragmentKey: "EXECUTIVE_SUMMARY",
        slides: [{ content: { bullets: [brief] } }],
      },
    ] as unknown as SectionPackV2[];
    expect(
      inspectCrossSlideDuplicateSentences(sharedBriefPacks).CROSS_SLIDE_DUPLICATE_SENTENCES
    ).toBe(0);

    const leaked = [
      ...sharedBriefPacks,
      {
        fragmentKey: "RU_SUMMARY",
        slides: [{ content: { bullets: [brief] } }],
      },
    ] as unknown as SectionPackV2[];
    expect(inspectCrossSlideDuplicateSentences(leaked).CROSS_SLIDE_DUPLICATE_SENTENCES).toBeGreaterThanOrEqual(1);

    const plan = buildCrossSlideDisclosurePlan({
      caseId: "c",
      datasetId: "d",
      composed: composed(),
      findings: [
        finding({
          findingId: "finding-criminal",
          theme: "Криминальные / судебные материалы",
          regions: ["RU"],
        }),
      ],
    });
    expect(plan.materials[0]!.briefText).not.toMatch(/Сверить первоисточник/i);
    expect(plan.materials[0]!.briefText).not.toContain(full.slice(0, 40));
  });
});
