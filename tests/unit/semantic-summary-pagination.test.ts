import { describe, expect, it } from "vitest";
import {
  assertSemanticPaginationGatesPass,
  bulletWithFindingIdAtomic,
  countClientTextTruncations,
  paginateThemeBlocks,
  repaginateThemeBearingPacks,
  resolveMaxThemeBlocksPerSlide,
} from "../../src/modules/digital-profile/orion-golden/deck-sections/semantic-summary-pagination";
import {
  geometryReportIsClean,
  loadGeometryFixture,
} from "../../src/modules/digital-profile/orion-golden/classic/generate-first36-geometry-artifacts";
import type { SlideContentContract } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";
import { SLIDE_CONTENT_SCHEMA_VERSION } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";

function baseSlide(bullets: string[]): SlideContentContract {
  return {
    schemaVersion: SLIDE_CONTENT_SCHEMA_VERSION,
    slideId: "ru-summary-main",
    sectionType: "RU",
    templateId: "regional-summary",
    title: "Резюме",
    content: { bullets, narrative: "Короткий вывод по региону." },
    evidenceRefs: [],
    findingIds: [],
  } as SlideContentContract;
}

describe("C7 semantic-summary-pagination", () => {
  it("moves whole theme blocks to continuation (never splits a bullet)", () => {
    const b1 =
      "«Криминальные / судебные материалы»\nПолный абзац номер один с источником и оговоркой о проверке документов.";
    const b2 =
      "«Политические связи / публичная экспозиция»\nПолный абзац номер два с отдельным why и рекомендованными проверками.";
    const b3 =
      "«Офшоры / корпоративное владение»\nПолный абзац номер три остаётся атомарным при переносе на продолжение.";
    const { slides, report } = paginateThemeBlocks({
      base: baseSlide([
        bulletWithFindingIdAtomic(b1, "finding-a"),
        bulletWithFindingIdAtomic(b2, "finding-b"),
        bulletWithFindingIdAtomic(b3, "finding-c"),
      ]),
      templateId: "regional-summary",
      maxThemeBlocksPerSlide: 2,
    });
    expect(slides.length).toBe(2);
    expect(slides[0]!.content.bullets).toHaveLength(2);
    expect(slides[1]!.isContinuation).toBe(true);
    expect(slides[1]!.continuationOf).toBe("ru-summary-main");
    expect(slides[1]!.content.bullets).toEqual([
      expect.stringContaining("finding-c"),
    ]);
    // Whole third bullet preserved (no mid-cut).
    expect(slides[1]!.content.bullets![0]).toContain("атомарным при переносе");
    expect(report.CLIENT_TEXT_TRUNCATIONS).toBe(0);
    assertSemanticPaginationGatesPass(report);
  });

  it("detects dangling mid-clip truncation markers", () => {
    const { count } = countClientTextTruncations([
      "Найдены публикации о финансовых претензиях и долговых спорах (в.",
    ]);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("uses 1 theme card/page when KPI chrome + long C6 full-disclosure bullets", () => {
    const long = `${"«Санкции»\n"}${"Полный разбор темы с источниками и проверками. ".repeat(20)}`;
    expect(long.length).toBeGreaterThan(360);
    expect(
      resolveMaxThemeBlocksPerSlide({
        bullets: [long, long, long],
        templateId: "regional-summary",
        hasKpiChrome: true,
      })
    ).toBe(1);

    const base = baseSlide([long, long, long]);
    base.content.kpis = [
      { label: "Материалов", value: "10", tone: "neutral" },
      { label: "Тем", value: "3", tone: "risk" },
    ];
    const { slides } = paginateThemeBlocks({ base, templateId: "regional-summary" });
    expect(slides).toHaveLength(3);
    expect(slides[0]!.content.bullets).toHaveLength(1);
    expect(slides[0]!.content.kpis?.length).toBe(2);
    expect(slides[1]!.isContinuation).toBe(true);
    expect(slides[1]!.content.kpis).toBeUndefined();
    expect(slides[1]!.content.bullets).toHaveLength(1);
  });

  it("repaginates stale packs that left 3+ long theme cards on the base slide", () => {
    const long = `${"«Тема»\n"}${"Длинный полный текст раскрытия. ".repeat(25)}`;
    const pack = {
      fragmentKey: "RU_SUMMARY",
      slides: [
        {
          ...baseSlide([long, long, long]),
          content: {
            ...baseSlide([long, long, long]).content,
            kpis: [{ label: "Тем", value: "3", tone: "risk" }],
          },
        },
      ],
    };
    expect(pack.slides[0]!.content.bullets).toHaveLength(3);
    const n = repaginateThemeBearingPacks([pack]);
    expect(n).toBe(1);
    expect(pack.slides.length).toBeGreaterThanOrEqual(3);
    expect(pack.slides.every((s) => (s.content.bullets?.length ?? 0) <= 1)).toBe(true);
  });

  it("geometry fixtures: clean PASS, clipping/overlap fail", () => {
    expect(geometryReportIsClean(loadGeometryFixture("clean-page.json"))).toBe(true);
    expect(geometryReportIsClean(loadGeometryFixture("clipping-overflow.json"))).toBe(
      false
    );
    expect(geometryReportIsClean(loadGeometryFixture("overlap.json"))).toBe(false);
  });
});
