import { describe, expect, it } from "vitest";
import {
  assertComposedSummaryGatesPass,
  composeClientSummary,
  countIncompleteSentences,
  themeBlockToClaimText,
} from "../../src/modules/digital-profile/orion-golden/analytics/client-summary-composer";
import type { CanonicalClaimBundle } from "../../src/modules/digital-profile/orion-golden/contracts/canonical-claim";
import { CANONICAL_CLAIM_SCHEMA_VERSION } from "../../src/modules/digital-profile/orion-golden/contracts/canonical-claim";

function claim(partial: {
  claimId: string;
  theme: string;
  clientDescription: string;
  whyItMatters: string;
  url?: string;
  inventoryId?: string;
  isAdverseTheme?: boolean;
}): CanonicalClaimBundle["claims"][number] {
  const desc = partial.clientDescription;
  return {
    schemaVersion: CANONICAL_CLAIM_SCHEMA_VERSION,
    claimId: partial.claimId,
    evidenceRefs: [`inventory:${partial.inventoryId ?? partial.claimId}`],
    inventoryId: partial.inventoryId ?? partial.claimId,
    url: partial.url ?? `https://news.example/${partial.claimId}`,
    theme: partial.theme,
    isAdverseTheme: partial.isAdverseTheme ?? true,
    riskLevel: "high",
    clientDescription: desc,
    displayExcerpt: desc,
    claimKind: "SOURCE_ALLEGATION",
    attribution: "сообщается",
    qualification:
      "Наличие публикации не подтверждает изложенные утверждения; требуется проверка.",
    recommendedChecks: ["Сверить первоисточник", "Запросить судебные документы"],
    whyItMatters: partial.whyItMatters,
    supportingSpans: [{ sentenceIndex: 0, quote: "расследование" }],
    contentSource: "full_text",
    originalFullTextRef: null,
    contentHash: "h1",
    findingIds: [`finding-${partial.claimId}`],
    semanticExcerptTruncations: 0,
  };
}

function bundle(claims: CanonicalClaimBundle["claims"]): CanonicalClaimBundle {
  return {
    schemaVersion: "canonical-claims-v1",
    caseId: "case-1",
    datasetId: "ds-1",
    generatedAt: new Date().toISOString(),
    claims,
    gates: {
      SEMANTIC_EXCERPT_TRUNCATIONS: 0,
      adverseClaims: claims.filter((c) => c.isAdverseTheme).length,
      adverseWithGroundedDescription: claims.filter((c) => c.isAdverseTheme).length,
      ADVERSE_GROUNDED_COVERAGE: 1,
    },
  };
}

describe("C5 client-summary-composer", () => {
  it("builds theme = conclusion → article retelling → article-specific why → checks", () => {
    const summary = composeClientSummary({
      caseId: "case-1",
      datasetId: "ds-1",
      claims: bundle([
        claim({
          claimId: "a1",
          theme: "criminal_legal",
          clientDescription:
            "Авторы расследования описывают обстоятельства совместного отдыха и возможный конфликт интересов.",
          whyItMatters:
            "Такой сюжет обычно запускает расширенную проверку контрагента и запрос первичных документов.",
        }),
        claim({
          claimId: "a2",
          theme: "criminal_legal",
          clientDescription:
            "В публикации изложен иск и ссылки на санкционные ограничения вокруг субъекта.",
          whyItMatters:
            "Судебный контур усиливает вопросы к правоспособности и репутационному риску сделки.",
          url: "https://nytimes.com/article",
        }),
      ]),
    });

    expect(summary.mediaThemeBlocks).toHaveLength(1);
    expect(summary.databaseThemeBlocks).toHaveLength(0);
    const block = summary.mediaThemeBlocks[0]!;
    expect(block.conclusion.length).toBeGreaterThan(20);
    expect(block.articles.length).toBeGreaterThanOrEqual(1);
    expect(block.articles.length).toBeLessThanOrEqual(2);
    expect(block.articles[0]!.body).toMatch(/В материале/);
    expect(block.articles[0]!.body).toMatch(/Источник:/);
    expect(block.articles[0]!.qualification.length).toBeGreaterThan(10);
    expect(block.whyItMatters).toContain(block.articles[0]!.whyItMatters.slice(0, 40));
    expect(block.recommendedChecks.length).toBeGreaterThanOrEqual(1);
    expect(themeBlockToClaimText(block)).toContain("Почему важно:");
    assertComposedSummaryGatesPass(summary);
  });

  it("keeps database/PEP themes separate from media blocks", () => {
    const summary = composeClientSummary({
      caseId: "case-1",
      datasetId: "ds-1",
      claims: bundle([
        claim({
          claimId: "m1",
          theme: "criminal_legal",
          clientDescription: "В СМИ описывается уголовный сюжет вокруг субъекта.",
          whyItMatters: "Криминальный сюжет требует проверки судебных реестров.",
        }),
        claim({
          claimId: "d1",
          theme: "pep_rca_watchlist",
          clientDescription: "В мониторинговой базе субъект отмечен как PEP.",
          whyItMatters: "Статус PEP меняет глубину KYC и набор обязательных проверок.",
          url: "https://dowjones.com/profile",
        }),
      ]),
    });
    expect(summary.mediaThemeBlocks.map((b) => b.themeId)).toEqual(["criminal_legal"]);
    expect(summary.databaseThemeBlocks.map((b) => b.themeId)).toEqual([
      "pep_rca_watchlist",
    ]);
    assertComposedSummaryGatesPass(summary);
  });

  it("fails PER_THEME_WHY when identical constant why collapses across themes", () => {
    const sameWhy =
      "Одинаковая константа почему важно для разных тем и разных статей — это шаблон, а не анализ.";
    const summary = composeClientSummary({
      caseId: "case-1",
      datasetId: "ds-1",
      claims: bundle([
        claim({
          claimId: "c1",
          theme: "criminal_legal",
          clientDescription: "Описание уголовного сюжета номер один для проверки коллапса why.",
          whyItMatters: sameWhy,
        }),
        claim({
          claimId: "p1",
          theme: "political_exposure",
          clientDescription: "Описание политической экспозиции номер два для проверки коллапса why.",
          whyItMatters: sameWhy,
          url: "https://politics.example/p1",
        }),
      ]),
    });
    expect(summary.gates.PER_THEME_WHY_IS_ARTICLE_SPECIFIC).toBe(false);
    expect(() => assertComposedSummaryGatesPass(summary)).toThrow(
      /PER_THEME_WHY_IS_ARTICLE_SPECIFIC/
    );
  });

  it("excludes C4 APPENDIX_OTHER evidence from media theme examples", () => {
    const summary = composeClientSummary({
      caseId: "case-1",
      datasetId: "ds-1",
      claims: bundle([
        claim({
          claimId: "junk",
          theme: "criminal_legal",
          clientDescription: "Мемный заголовок без аналитической ценности.",
          whyItMatters: "Не должно попасть в клиентский блок как пример.",
        }),
        claim({
          claimId: "ok",
          theme: "criminal_legal",
          clientDescription:
            "Содержательный пересказ расследования с именами, обстоятельствами и риском.",
          whyItMatters:
            "Именно этот материал задаёт конкретный why для криминально-судебной темы.",
          url: "https://currenttime.tv/article",
        }),
      ]),
      excludeEvidenceRefs: ["inventory:junk"],
    });
    const refs = summary.mediaThemeBlocks[0]!.articles.map((a) => a.evidenceRef);
    expect(refs).toEqual(["inventory:ok"]);
    expect(refs).not.toContain("inventory:junk");
    assertComposedSummaryGatesPass(summary);
  });

  it("resolves Finding theme labels to themeId for grouping", () => {
    const summary = composeClientSummary({
      caseId: "case-1",
      datasetId: "ds-1",
      claims: bundle([
        claim({
          claimId: "l1",
          theme: "Криминальные / судебные материалы",
          clientDescription:
            "Пересказ судебного сюжета с оговоркой о необходимости проверки документов.",
          whyItMatters:
            "Судебный контур влияет на приемлемость контрагента для сделки.",
          isAdverseTheme: true,
        }),
      ]),
      materialThemeKeys: ["criminal_legal"],
    });
    expect(summary.mediaThemeBlocks.map((b) => b.themeId)).toEqual([
      "criminal_legal",
    ]);
    expect(summary.gates.SUMMARY_MATERIAL_THEME_COVERAGE).toBe(1);
    assertComposedSummaryGatesPass(summary);
  });

  it("does not flag abbreviation splits (см. / т.д.) as incomplete sentences", () => {
    expect(
      countIncompleteSentences(
        "В материале см. первоисточник и т. д. Требуется проверка первичных документов."
      )
    ).toBe(0);
    expect(
      countIncompleteSentences(
        "После публикации расследования ФБК об отдыхе Дерипаски,"
      )
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not flag closed sentences that contain an odd ASCII quote", () => {
    expect(
      countIncompleteSentences(
        'В материале rbc.ru сообщается — компания "Русал" под ограничениями.'
      )
    ).toBe(0);
  });

  it("still flags trailing ellipsis mid-cuts without a hard stop", () => {
    expect(
      countIncompleteSentences(
        "После публикации расследования ФБК об отдыхе Дерипаски…"
      )
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not flag Russian ». closings or ORION scan lines as incomplete", () => {
    expect(
      countIncompleteSentences(
        "«Самый говорливый олигарх.» — источник dzen.ru\nВсего по теме: 21 материал\nГде видно: dzen.ru, reuters.com"
      )
    ).toBe(0);
    expect(
      countIncompleteSentences(
        "Ключевой материал: reuters.com\nЧто проверить: Сверить первоисточник"
      )
    ).toBe(0);
  });
});
