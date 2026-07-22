import { describe, expect, it } from "vitest";
import {
  assertSemanticPaginationGatesPass,
  bulletWithFindingIdAtomic,
  countClientTextTruncations,
  paginateThemeBlocks,
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

  it("geometry fixtures: clean PASS, clipping/overlap fail", () => {
    expect(geometryReportIsClean(loadGeometryFixture("clean-page.json"))).toBe(true);
    expect(geometryReportIsClean(loadGeometryFixture("clipping-overflow.json"))).toBe(
      false
    );
    expect(geometryReportIsClean(loadGeometryFixture("overlap.json"))).toBe(false);
  });
});
