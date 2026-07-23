import { describe, expect, it } from "vitest";
import {
  assertDisclosurePlanGatesPass,
  buildCrossSlideDisclosurePlan,
} from "../../src/modules/digital-profile/orion-golden/analytics/cross-slide-disclosure-planner";
import {
  assertCrossSlideDedupeGatesPass,
  inspectCrossSlideDuplicateSentences,
} from "../../src/modules/digital-profile/orion-golden/deck-sections/cross-slide-dedupe-qa";
import { repairCrossSlideDuplicateCopy } from "../../src/modules/digital-profile/orion-golden/deck-sections/cross-slide-dedupe-repair";
import {
  buildPageEvidenceView,
  pageFindingBlocks,
  resolveDisclosureClaimText,
  statusLine,
  surfaceWhatToCheck,
} from "../../src/modules/digital-profile/orion-golden/deck-sections/fragment-builders/shared";
import type { ComposedClientSummary } from "../../src/modules/digital-profile/orion-golden/contracts/composed-client-summary";
import type { Finding } from "../../src/modules/digital-profile/orion-golden/contracts/finding";
import type { SectionPackV2 } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";
import { COMPOSED_CLIENT_SUMMARY_VERSION } from "../../src/modules/digital-profile/orion-golden/contracts/composed-client-summary";
import type { ScopedFragmentInput } from "../../src/modules/digital-profile/orion-golden/deck-sections/scoped-input";

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
    const ruSerp = resolveDisclosureClaimText(f, "RU_SERP", extras);
    const uaeSerp = resolveDisclosureClaimText(f, "UAE_SERP", extras);
    expect(ruSerp).toMatch(/российск/u);
    expect(uaeSerp).toMatch(/международн/u);
    expect(ruSerp).not.toEqual(uaeSerp);
    // Page-scoped SERP QA: surface angle must not embed concrete domains.
    expect(ruSerp).not.toMatch(/\b[\w-]+\.[\w.-]+\b/u);
    expect(m.surfaceAngles.serp).not.toMatch(/\b[\w-]+\.[\w.-]+\b/u);
  });

  it("SERP sidebar without disclosure plan stays page-scoped (no global claim domains)", () => {
    const f = finding({
      findingId: "finding-criminal",
      theme: "Криминальные / судебные материалы",
      claim:
        "По теме видны материалы highways.today и tadviser.com — полный разбор в резюме.",
      evidenceRefs: ["inventory:on-page", "inventory:off-page"],
      sourceDomains: ["highways.today", "tadviser.com", "reuters.com"],
    });
    const scoped = {
      findings: [f],
      evidenceIndex: {
        "inventory:on-page": {
          domain: "reuters.com",
          title: "Судебный сюжет",
          url: "https://reuters.com/a",
        },
        "inventory:off-page": {
          domain: "highways.today",
          title: "Другая страница",
          url: "https://highways.today/b",
        },
      },
      metricSnapshot: { perRegionCounts: { RU: 1 }, ambiguousCount: 0 },
      surfaceUnits: [],
    } as unknown as ScopedFragmentInput;
    const view = buildPageEvidenceView(scoped, ["inventory:on-page"]);
    const blocks = pageFindingBlocks(scoped, view, undefined, {}, "RU_SERP");
    expect(blocks.whatWasFound).toMatch(/reuters\.com/u);
    expect(blocks.whatWasFound).not.toMatch(/highways\.today|tadviser\.com/u);
    expect(blocks.sourceNote).toMatch(/reuters\.com/u);
    expect(blocks.sourceNote).not.toMatch(/highways\.today/u);
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

  it("never resolves executive briefText onto a non-owner RU_SUMMARY page", () => {
    const plan = buildCrossSlideDisclosurePlan({
      caseId: "c",
      datasetId: "d",
      composed: composed(),
      findings: [
        finding({
          findingId: "finding-criminal",
          theme: "Криминальные / судебные материалы",
          regions: ["UAE"],
        }),
      ],
    });
    const m = plan.materials[0]!;
    expect(m.fullOwnerFragment).toBe("UAE_SUMMARY");
    const extras = { crossSlideDisclosurePlan: plan };
    const f = finding({
      findingId: "finding-criminal",
      theme: "Криминальные / судебные материалы",
      regions: ["UAE"],
    });
    const exec = resolveDisclosureClaimText(f, "EXECUTIVE_SUMMARY", extras);
    const overview = resolveDisclosureClaimText(f, "DIGITAL_PROFILE_OVERVIEW", extras);
    const ru = resolveDisclosureClaimText(f, "RU_SUMMARY", extras);
    const uae = resolveDisclosureClaimText(f, "UAE_SUMMARY", extras);
    expect(exec).toBe(m.briefText);
    expect(overview).toBe(m.briefText);
    expect(uae).toBe(m.fullText);
    expect(ru).not.toBe(m.briefText);
    expect(ru).not.toBe(m.fullText);
    expect(ru).toMatch(/не повторяется/i);

    const packs = [
      {
        fragmentKey: "DIGITAL_PROFILE_OVERVIEW",
        slides: [{ content: { bullets: [overview] } }],
      },
      {
        fragmentKey: "EXECUTIVE_SUMMARY",
        slides: [{ content: { bullets: [exec] } }],
      },
      {
        fragmentKey: "RU_SUMMARY",
        slides: [{ content: { bullets: [ru] } }],
      },
      {
        fragmentKey: "UAE_SUMMARY",
        slides: [{ content: { bullets: [uae] } }],
      },
    ] as unknown as SectionPackV2[];
    const report = inspectCrossSlideDuplicateSentences(packs);
    expect(report.CROSS_SLIDE_DUPLICATE_SENTENCES).toBe(0);
    expect(() =>
      assertCrossSlideDedupeGatesPass({
        ...report,
        MATERIALS_WITHOUT_FULL_DISCLOSURE: 0,
        MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES: 0,
      })
    ).not.toThrow();
  });

  it("repairs SERP↔screenshot and IDENTITY↔AI collisions with distinct copy", () => {
    const packs = [
      {
        fragmentKey: "UAE_SERP",
        slides: [
          {
            content: {
              whatToCheck:
                "Сверить выделенные на этой странице результаты выдачи с первоисточниками.",
              statusNote:
                "Статус: состав страницы описан по строкам таблицы; отдельного тематического вывода нет.",
            },
          },
        ],
      },
      {
        fragmentKey: "UAE_SERP_SCREENSHOT",
        slides: [
          {
            content: {
              whatToCheck:
                "Сверить выделенные на этой странице результаты выдачи с первоисточниками.",
              statusNote:
                "Статус: состав страницы описан по строкам таблицы; отдельного тематического вывода нет.",
            },
          },
        ],
      },
      {
        fragmentKey: "UAE_IDENTITY_WIKIPEDIA",
        slides: [
          {
            content: {
              statusNote:
                "Статус: состав страницы описан по строкам таблицы; отдельного тематического вывода нет.",
            },
          },
        ],
      },
      {
        fragmentKey: "UAE_KNOWLEDGE_AI",
        slides: [
          {
            content: {
              statusNote:
                "Статус: состав страницы описан по строкам таблицы; отдельного тематического вывода нет.",
            },
          },
        ],
      },
    ] as unknown as SectionPackV2[];

    expect(inspectCrossSlideDuplicateSentences(packs).CROSS_SLIDE_DUPLICATE_SENTENCES).toBeGreaterThan(
      0
    );
    const repair = repairCrossSlideDuplicateCopy(packs);
    expect(repair.after).toBe(0);
    expect(packs[0]!.slides[0]!.content.whatToCheck).toMatch(/таблице выдачи/u);
    expect(packs[1]!.slides[0]!.content.whatToCheck).toMatch(/снимке/u);
    expect(packs[0]!.slides[0]!.content.whatToCheck).not.toEqual(
      packs[1]!.slides[0]!.content.whatToCheck
    );
    expect(packs[2]!.slides[0]!.content.statusNote).toMatch(/справочной карточке/u);
    expect(packs[3]!.slides[0]!.content.statusNote).toMatch(/ИИ-ответов/u);
  });

  it("repairs live-style GPT/boilerplate duplicates before the C6 gate", () => {
    const action =
      "Проверить статусы дел по судебным картотекам и официальным источникам; собрать документы о прекращении или исходе.";
    const packs = [
      {
        fragmentKey: "RU_SUMMARY",
        slides: [
          {
            content: {
              bullets: [
                "Материалы, вероятно относящиеся к субъекту: 37 — пока не включаем в подтверждённый итог до уточнения идентификации.",
              ],
              whatToCheck: action,
            },
          },
        ],
      },
      {
        fragmentKey: "UAE_SUMMARY",
        slides: [
          {
            content: {
              bullets: [
                "Материалы, вероятно относящиеся к субъекту: 37 — пока не включаем в подтверждённый итог до уточнения идентификации.",
              ],
              whatToCheck: action,
            },
          },
        ],
      },
      {
        fragmentKey: "RU_IMAGES",
        slides: [
          {
            content: {
              statusNote:
                "Статус: тема подтверждена, уровень внимания — критический; достоверность оценки высокая.",
              whatToCheck: action,
            },
          },
        ],
      },
      {
        fragmentKey: "RU_SERP",
        slides: [
          {
            content: {
              statusNote:
                "Статус: тема подтверждена, уровень внимания — критический; достоверность оценки высокая.",
              whatToCheck: action,
            },
          },
        ],
      },
    ] as unknown as SectionPackV2[];

    expect(inspectCrossSlideDuplicateSentences(packs).CROSS_SLIDE_DUPLICATE_SENTENCES).toBeGreaterThan(
      0
    );
    const repair = repairCrossSlideDuplicateCopy(packs);
    expect(repair.after).toBe(0);
    expect(repair.repairedFields).toBeGreaterThan(0);
    expect(packs[0]!.slides[0]!.content.bullets![0]).toMatch(/По региону «Россия»/u);
    expect(packs[1]!.slides[0]!.content.bullets![0]).toMatch(/По региону «ОАЭ/u);
    expect(packs[2]!.slides[0]!.content.statusNote).toMatch(/блоку изображений/u);
    expect(packs[3]!.slides[0]!.content.statusNote).toMatch(/таблице поисковой выдачи/u);
    expect(packs[3]!.slides[0]!.content.whatToCheck).not.toEqual(action);
    expect(() =>
      assertCrossSlideDedupeGatesPass({
        ...inspectCrossSlideDuplicateSentences(packs),
        MATERIALS_WITHOUT_FULL_DISCLOSURE: 0,
        MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES: 0,
      })
    ).not.toThrow();
  });

  it("scopes status and checks so SERP/IMAGES/regional summaries do not share sentences", () => {
    const f = finding({
      findingId: "finding-criminal",
      theme: "Криминальные / судебные материалы",
      recommendedAction:
        "Проверить статусы дел по судебным картотекам и официальным источникам; собрать документы о прекращении или исходе.",
      confidence: 0.9,
      riskLevel: "critical",
    });
    const serpStatus = statusLine(f, { fragmentKey: "RU_SERP" });
    const imagesStatus = statusLine(f, { fragmentKey: "RU_IMAGES" });
    expect(serpStatus).not.toEqual(imagesStatus);
    expect(serpStatus).toMatch(/таблице поисковой выдачи/u);
    expect(imagesStatus).toMatch(/блоку изображений/u);

    const serpCheck = surfaceWhatToCheck("RU_SERP", f.recommendedAction);
    const shotCheck = surfaceWhatToCheck("RU_SERP_SCREENSHOT", f.recommendedAction);
    const imagesCheck = surfaceWhatToCheck("RU_IMAGES", f.recommendedAction);
    expect(serpCheck).not.toEqual(f.recommendedAction);
    expect(shotCheck).not.toEqual(serpCheck);
    expect(imagesCheck).not.toEqual(f.recommendedAction);
    expect(serpCheck).not.toEqual(imagesCheck);

    const packs = [
      {
        fragmentKey: "RU_SUMMARY",
        slides: [
          {
            content: {
              bullets: [
                "По региону «Россия»: материалы со статусом «вероятно о субъекте» (37) пока не включаем в подтверждённый итог до уточнения идентификации.",
              ],
              whatToCheck: `В разделе «Россия»: ${f.recommendedAction}`,
            },
          },
        ],
      },
      {
        fragmentKey: "UAE_SUMMARY",
        slides: [
          {
            content: {
              bullets: [
                "По региону «Международный поиск»: материалы со статусом «вероятно о субъекте» (37) пока не включаем в подтверждённый итог до уточнения идентификации.",
              ],
              whatToCheck: `В разделе «Международный поиск»: ${f.recommendedAction}`,
            },
          },
        ],
      },
      {
        fragmentKey: "RU_SERP",
        slides: [{ content: { statusNote: serpStatus, whatToCheck: serpCheck } }],
      },
      {
        fragmentKey: "RU_IMAGES",
        slides: [{ content: { statusNote: imagesStatus, whatToCheck: imagesCheck } }],
      },
    ] as unknown as SectionPackV2[];
    expect(inspectCrossSlideDuplicateSentences(packs).CROSS_SLIDE_DUPLICATE_SENTENCES).toBe(0);
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
