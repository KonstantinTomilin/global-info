/**
 * Hard QA gate for CEO demo first-36 deck.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OrionGoldenDeckManifest } from "../composer/orion-deck-composer";
import type { ReportAssetV1 } from "../../orion-report-spec/asset-builder";
import {
  CEO_FIRST_36_SLIDE_COUNT,
  ORION_FIRST_36_SLIDE_REGISTRY_V1,
} from "./orion-first-36-slide-registry.v1";
import type { MetricRegistry } from "./report-metric-registry";

const VISUAL_CEO_TEMPLATES = new Set([
  "ceo_cover",
  "ceo_toc",
  "ceo_executive_dashboard",
  "ceo_kpi_cards",
  "ceo_region_divider",
  "ceo_serp_matrix",
  "ceo_serp_evidence",
  "ceo_media_grid",
  "ceo_knowledge_panel",
  "ceo_compliance_profile",
]);

const COMMERCIAL_KEYS = new Set([
  "offer",
  "product_overview",
  "solution_digital_profile",
  "about",
]);

export type CeoQualityCheck = {
  id: string;
  passed: boolean;
  hard: boolean;
  detail: string;
};

export function inspectCeoFirst36Quality(input: {
  deckManifest: OrionGoldenDeckManifest;
  metrics: MetricRegistry;
  assets: ReportAssetV1[];
  outputRoot?: string;
}): {
  passed: boolean;
  hardFailed: boolean;
  issues: string[];
  checks: CeoQualityCheck[];
  visualTemplateCount: number;
} {
  const issues: string[] = [];
  const checks: CeoQualityCheck[] = [];
  const slides = input.deckManifest.finalSlides;

  const slideCountOk = slides.length === CEO_FIRST_36_SLIDE_COUNT;
  checks.push({
    id: "exact-36-slides",
    passed: slideCountOk,
    hard: true,
    detail: `${slides.length} slides (required ${CEO_FIRST_36_SLIDE_COUNT})`,
  });

  const pageMapOk = ORION_FIRST_36_SLIDE_REGISTRY_V1.every((entry, idx) => {
    const slide = slides[idx];
    return (
      slide?.pageNumber === entry.referencePage &&
      slide?.sectionKey === entry.sectionKey &&
      slide?.template === entry.template
    );
  });
  checks.push({
    id: "registry-page-mapping",
    passed: pageMapOk,
    hard: true,
    detail: pageMapOk ? "referencePage→sectionKey/template aligned" : "registry slot mismatch",
  });

  const commercial = slides.filter((s) => COMMERCIAL_KEYS.has(s.sectionKey));
  checks.push({
    id: "no-commercial-tail",
    passed: commercial.length === 0,
    hard: true,
    detail: commercial.length ? `${commercial.length} commercial slides` : "no commercial sections",
  });

  const matrixBullets = slides
    .filter((s) => s.template === "ceo_serp_matrix")
    .flatMap((s) => s.bullets ?? []);
  const dashRank = matrixBullets.some((b) => /#\s*—|#\s*–|rank:\s*—/i.test(b));
  checks.push({
    id: "no-dash-rank-matrix",
    passed: !dashRank,
    hard: true,
    detail: dashRank ? "matrix contains #— placeholder" : "matrix ranks numeric",
  });

  const texts = slides.flatMap((s) => [s.title, s.narrative ?? "", ...(s.bullets ?? [])]);
  const falseExtreme =
    input.metrics.dataMode !== "RUN_SCOPED" &&
    texts.some((t) => /крайне\s+негативн/i.test(t));
  checks.push({
    id: "no-untrusted-extreme-label",
    passed: !falseExtreme,
    hard: true,
    detail: falseExtreme ? "extreme label without RUN_SCOPED" : "risk labels gated",
  });

  const visualTemplateCount = slides.filter((s) => VISUAL_CEO_TEMPLATES.has(s.template)).length;
  checks.push({
    id: "visual-template-floor",
    passed: visualTemplateCount >= 24,
    hard: false,
    detail: `${visualTemplateCount}/36 visual templates (min 24)`,
  });

  const serpWithImage = slides
    .filter((s) => s.template === "ceo_serp_evidence")
    .filter((s) => (s.assetRefs ?? []).some((ref) => input.assets.some((a) => a.assetRef === ref && a.imageData)));
  checks.push({
    id: "serp-evidence-embedded",
    passed: serpWithImage.length >= 1,
    hard: false,
    detail: `${serpWithImage.length} SERP slides with imageData`,
  });

  if (input.outputRoot) {
    const pagesDir = join(input.outputRoot, "pages-png");
    const pageFiles = existsSync(pagesDir)
      ? readdirSync(pagesDir).filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      : [];
    checks.push({
      id: "rendered-page-count",
      passed: pageFiles.length === CEO_FIRST_36_SLIDE_COUNT || pageFiles.length === 0,
      hard: pageFiles.length > 0 && pageFiles.length !== CEO_FIRST_36_SLIDE_COUNT,
      detail: `${pageFiles.length || "n/a"} PNG pages`,
    });
  }

  for (const check of checks) {
    if (!check.passed) issues.push(`${check.id}: ${check.detail}`);
  }

  const hardFailed = checks.some((c) => c.hard && !c.passed);
  const passed = !hardFailed && checks.filter((c) => !c.hard && !c.passed).length === 0;

  return { passed, hardFailed, issues, checks, visualTemplateCount };
}
