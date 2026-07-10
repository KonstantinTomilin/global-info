/**
 * Hard QA gate for CEO demo first-36 deck (recovery).
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
import { scanCeoClientTextLeaks } from "./ceo-client-labels";

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
  sliceReadiness?: {
    passed: boolean;
    hardFailed: boolean;
    issues: string[];
    checks: Array<{ id: string; passed: boolean; hard: boolean; detail: string }>;
  };
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

  if (input.sliceReadiness) {
    for (const c of input.sliceReadiness.checks) {
      checks.push({ id: c.id, passed: c.passed, hard: c.hard, detail: c.detail });
    }
  }

  const texts = slides.flatMap((s) => [s.title, s.narrative ?? "", ...(s.bullets ?? [])]);
  const leaks = scanCeoClientTextLeaks(texts);
  checks.push({
    id: "client-text-scan",
    passed: leaks.length === 0,
    hard: true,
    detail: leaks.length ? leaks.slice(0, 3).join("; ") : "no policy leaks",
  });

  const blockedReady = slides.filter(
    (s) => s.ceoMeta?.readiness === "blocked" && (s.bullets ?? []).some((b) => /материал недоступен/i.test(b))
  );
  checks.push({
    id: "blocked-not-fake-ready-copy",
    passed: blockedReady.length === 0,
    hard: true,
    detail: blockedReady.length ? `blocked slides with fake-ready copy: ${blockedReady.map((s) => s.pageNumber).join(",")}` : "ok",
  });

  const visualTemplateCount = slides.filter((s) =>
    /ceo_(cover|toc|executive_dashboard|kpi_cards|region_divider|serp_matrix|serp_evidence|media_grid|knowledge_panel|compliance_profile)/.test(
      s.template
    )
  ).length;
  checks.push({
    id: "visual-template-floor",
    passed: visualTemplateCount >= 20,
    hard: false,
    detail: `${visualTemplateCount}/36 visual templates`,
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
    detail: pageMapOk ? "aligned" : "registry mismatch",
  });

  for (const check of checks) {
    if (!check.passed) issues.push(`${check.id}: ${check.detail}`);
  }

  const hardFailed =
    checks.some((c) => c.hard && !c.passed) || Boolean(input.sliceReadiness?.hardFailed);
  const passed = !hardFailed;

  return { passed, hardFailed, issues, checks, visualTemplateCount };
}
