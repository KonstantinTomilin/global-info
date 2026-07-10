/**
 * Vertical slice readiness gates for CEO first-36 recovery.
 */

import type { OrionGoldenDeckManifest, OrionGoldenDeckSlide } from "../composer/orion-deck-composer";
import type { ReportAssetV1 } from "../../orion-report-spec/asset-builder";
import { CEO_FIRST_36_SLIDE_COUNT } from "./orion-first-36-slide-registry.v1";
import { assetByRegion } from "./ceo-entity-filter";
import { scanCeoClientTextLeaks } from "./ceo-client-labels";
import type { MetricRegistry } from "./report-metric-registry";

export type CeoSliceId = "S1_1_10" | "S2_11_22" | "S3_23_32" | "S4_33_36";

export type SliceReadinessCheck = {
  id: string;
  slice: CeoSliceId;
  passed: boolean;
  hard: boolean;
  detail: string;
};

const DIVIDER_TEMPLATES = new Set(["ceo_cover", "ceo_toc", "ceo_region_divider"]);

function slideTexts(slide: OrionGoldenDeckSlide): string[] {
  return [slide.title, slide.narrative ?? "", ...(slide.bullets ?? [])];
}

function isBlankContentSlide(slide: OrionGoldenDeckSlide): boolean {
  if (DIVIDER_TEMPLATES.has(slide.template)) return false;
  if (slide.ceoMeta?.readiness === "blocked") return false;
  const hasAssets = (slide.assetRefs ?? []).length > 0;
  const hasNarrative = Boolean(slide.narrative?.trim());
  const bulletCount = (slide.bullets ?? []).filter((b) => b.trim().length > 2).length;
  if (hasAssets) return false;
  if (slide.template === "ceo_serp_evidence" || slide.template === "ceo_media_grid") {
    return !hasAssets;
  }
  if (slide.template === "ceo_knowledge_panel" || slide.template === "ceo_compliance_profile") {
    return !hasAssets && bulletCount < 2;
  }
  if (slide.template === "ceo_status_table") {
    return bulletCount < 1 && !hasNarrative;
  }
  return !hasNarrative && bulletCount < 2;
}

function slidesInRange(manifest: OrionGoldenDeckManifest, from: number, to: number): OrionGoldenDeckSlide[] {
  return manifest.finalSlides.filter((s) => s.pageNumber >= from && s.pageNumber <= to);
}

export function evaluateCeoSliceReadiness(input: {
  deckManifest: OrionGoldenDeckManifest;
  metrics: MetricRegistry;
  assets: ReportAssetV1[];
  subjectName: string;
}): {
  passed: boolean;
  hardFailed: boolean;
  checks: SliceReadinessCheck[];
  issues: string[];
  sliceStatus: Record<CeoSliceId, "PASS" | "FAIL" | "BLOCKED">;
} {
  const checks: SliceReadinessCheck[] = [];
  const { deckManifest, metrics, assets } = input;

  // Client text leaks — global hard blocker
  const allTexts = deckManifest.finalSlides.flatMap(slideTexts);
  const leaks = scanCeoClientTextLeaks(allTexts);
  checks.push({
    id: "no-client-policy-leaks",
    slice: "S1_1_10",
    passed: leaks.length === 0,
    hard: true,
    detail: leaks.length ? leaks.slice(0, 3).join("; ") : "clean",
  });

  // S1: pages 1-10
  const s1 = slidesInRange(deckManifest, 1, 10);
  const execSlide = s1.find((s) => s.template === "ceo_executive");
  const execOk = Boolean(execSlide?.narrative && execSlide.narrative.length > 80);
  checks.push({
    id: "s1-executive-substantive",
    slice: "S1_1_10",
    passed: execOk,
    hard: true,
    detail: execOk ? "executive résumé present" : "executive too thin",
  });

  const dashSlide = s1.find((s) => s.template === "ceo_executive_dashboard");
  const dashBullets = (dashSlide?.bullets ?? []).filter((b) => b.length > 5).length;
  checks.push({
    id: "s1-dashboard-density",
    slice: "S1_1_10",
    passed: dashBullets >= 4,
    hard: true,
    detail: `${dashBullets} dashboard rows (min 4)`,
  });

  const ruMatrix = s1.find((s) => s.sectionKey === "ru_serp_matrix");
  const matrixRows = (ruMatrix?.bullets ?? []).length;
  checks.push({
    id: "s1-ru-matrix-rows",
    slice: "S1_1_10",
    passed: matrixRows >= 5,
    hard: true,
    detail: `${matrixRows} matrix rows (min 5)`,
  });

  const ruSerp = s1.find((s) => s.sectionKey === "ru_serp_evidence");
  const ruSerpOk = Boolean(
    ruSerp?.assetRefs?.length &&
      ruSerp.assetRefs.some((ref) => assets.some((a) => a.assetRef === ref && a.imageData))
  );
  checks.push({
    id: "s1-ru-serp-visual",
    slice: "S1_1_10",
    passed: ruSerpOk,
    hard: true,
    detail: ruSerpOk ? "RU SERP embedded" : "RU SERP missing",
  });

  // S2: pages 11-22
  const s2 = slidesInRange(deckManifest, 11, 22);
  const suggestSlides = s2.filter((s) => s.template === "ceo_autocomplete" && s.sectionKey.includes("autocomplete"));
  const suggestItems = suggestSlides.reduce((n, s) => n + (s.bullets?.length ?? 0), 0);
  checks.push({
    id: "s2-ru-suggestions",
    slice: "S2_11_22",
    passed: suggestItems >= 8,
    hard: true,
    detail: `${suggestItems} suggestion items (min 8)`,
  });

  const ruImages = assetByRegion(assets, "RU", "image_grid").filter((a) => a.imageData);
  checks.push({
    id: "s2-ru-image-pool",
    slice: "S2_11_22",
    passed: ruImages.length >= 12,
    hard: true,
    detail: `${ruImages.length} RU images (min 12 for recovery; target 24)`,
  });

  const imageSlides = s2.filter((s) => s.template === "ceo_media_grid");
  const imageSlideAssets = imageSlides.filter((s) => (s.assetRefs ?? []).length >= 3).length;
  checks.push({
    id: "s2-ru-image-slides-filled",
    slice: "S2_11_22",
    passed: imageSlideAssets >= 2,
    hard: true,
    detail: `${imageSlideAssets}/4 image slides with ≥3 assets`,
  });

  const kgSlides = s2.filter((s) => s.template === "ceo_knowledge_panel");
  const kgOk = kgSlides.some((s) =>
    (s.assetRefs ?? []).some((ref) => assets.some((a) => a.assetRef === ref && a.imageData))
  );
  checks.push({
    id: "s2-ru-knowledge-visual",
    slice: "S2_11_22",
    passed: kgOk,
    hard: false,
    detail: kgOk ? "knowledge visual present" : "BLOCKED_MISSING_SOURCE_ASSET",
  });

  const relatedSlides = s2.filter((s) => s.sectionKey.includes("related"));
  const relatedItems = relatedSlides.reduce((n, s) => n + (s.bullets?.length ?? 0), 0);
  checks.push({
    id: "s2-ru-related-queries",
    slice: "S2_11_22",
    passed: relatedItems >= 6,
    hard: true,
    detail: `${relatedItems} related items (min 6; target 18)`,
  });

  // S3: pages 23-32
  const s3 = slidesInRange(deckManifest, 23, 32);
  const uaeSerp = s3.find((s) => s.sectionKey === "uae_serp_evidence");
  const uaeSerpOk = Boolean(
    uaeSerp?.assetRefs?.length &&
      uaeSerp.assetRefs.some((ref) => assets.some((a) => a.assetRef === ref && a.imageData))
  );
  checks.push({
    id: "s3-uae-serp-visual",
    slice: "S3_23_32",
    passed: uaeSerpOk,
    hard: true,
    detail: uaeSerpOk ? "UAE SERP embedded" : "UAE SERP missing",
  });

  const uaeImages = assetByRegion(assets, "UAE", "image_grid").filter((a) => a.imageData);
  checks.push({
    id: "s3-uae-image-pool",
    slice: "S3_23_32",
    passed: uaeImages.length >= 3,
    hard: true,
    detail: `${uaeImages.length} UAE images (min 3; target 6)`,
  });

  const uaeMatrix = metrics.uae.matrixRows.length;
  checks.push({
    id: "s3-uae-matrix",
    slice: "S3_23_32",
    passed: uaeMatrix >= 1 || metrics.dataMode !== "RUN_SCOPED",
    hard: false,
    detail: `${uaeMatrix} UAE matrix rows`,
  });

  // S4: pages 33-36 compliance
  const s4 = slidesInRange(deckManifest, 33, 36);
  const lexisAssets = assets.filter((a) => a.kind === "lexis_visual_page" && a.status === "ready" && a.imageData);
  const lexisOk = lexisAssets.length >= 1;
  checks.push({
    id: "s4-lexis-visual",
    slice: "S4_33_36",
    passed: lexisOk,
    hard: false,
    detail: lexisOk ? `${lexisAssets.length} Lexis pages` : "BLOCKED_MISSING_SOURCE_ASSET",
  });

  const djSlide = s4.find((s) => s.sectionKey.includes("dow_jones"));
  const djHasVisual = Boolean(
    djSlide?.assetRefs?.length &&
      djSlide.assetRefs.some((ref) => assets.some((a) => a.assetRef === ref && a.imageData))
  );
  checks.push({
    id: "s4-dow-jones-visual",
    slice: "S4_33_36",
    passed: djHasVisual,
    hard: false,
    detail: djHasVisual ? "DJ visual present" : "BLOCKED_MISSING_SOURCE_ASSET",
  });

  // Blank non-divider pages
  const blankSlides = deckManifest.finalSlides.filter(isBlankContentSlide);
  checks.push({
    id: "no-blank-content-pages",
    slice: "S1_1_10",
    passed: blankSlides.length === 0,
    hard: true,
    detail: blankSlides.length
      ? `blank pages: ${blankSlides.map((s) => s.pageNumber).join(",")}`
      : "no blank content pages",
  });

  checks.push({
    id: "exact-36",
    slice: "S1_1_10",
    passed: deckManifest.slideCount === CEO_FIRST_36_SLIDE_COUNT,
    hard: true,
    detail: `${deckManifest.slideCount} slides`,
  });

  const sliceIds: CeoSliceId[] = ["S1_1_10", "S2_11_22", "S3_23_32", "S4_33_36"];
  const sliceStatus = Object.fromEntries(
    sliceIds.map((sid) => {
      const sliceChecks = checks.filter((c) => c.slice === sid);
      const hardFail = sliceChecks.some((c) => c.hard && !c.passed);
      const softFail = sliceChecks.some((c) => !c.hard && !c.passed);
      const status: "PASS" | "FAIL" | "BLOCKED" = hardFail ? "FAIL" : softFail ? "BLOCKED" : "PASS";
      return [sid, status];
    })
  ) as Record<CeoSliceId, "PASS" | "FAIL" | "BLOCKED">;

  const issues = checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`);
  const hardFailed = checks.some((c) => c.hard && !c.passed);
  const passed = !hardFailed && sliceStatus.S4_33_36 !== "FAIL";

  return { passed, hardFailed, checks, issues, sliceStatus };
}
