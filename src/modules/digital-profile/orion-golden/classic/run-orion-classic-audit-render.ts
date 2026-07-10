/**
 * R10.11 — Classic ORION audit render pipeline (post-review content → PDF/PPTX).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRealCaseContext } from "../../orion-section-pipeline/real-case-data-adapter";
import {
  ORION_GOLDEN_QA_STORAGE_ROOT,
  caseScopedArtifactRoot,
} from "../evidence/admin-review-decision-store";
import { buildFullEvidenceInventory } from "../evidence/full-evidence-inventory";
import type { OrionClientContent } from "../content/orion-client-content-builder";
import { inspectOrionGoldenClientPolicy } from "../qa/client-policy-inspection";
import { inspectOrionGoldenVisualQuality } from "../qa/visual-qa-inspection";
import { renderOrionGoldenArtifacts } from "../renderer/orion-golden-render-client";
import { buildOrionClassicAuditAssets } from "./orion-classic-asset-builder";
import { composeOrionClassicAuditDeck } from "./orion-classic-audit-deck-composer";
import { buildOrionClassicReportSpecFromClientContent } from "./orion-classic-client-content-to-report-spec";
import { buildOrionThemeSet } from "./orion-classic-theme-set";
import { inspectClassicOrionAuditQuality } from "./orion-classic-audit-quality-inspection";
import { isClientProductionFinalize } from "./orion-classic-live-serp-assets";
import { evaluateClassicProviderSerpGate } from "./orion-classic-provider-serp-assets";
import { isCeoDemoMode } from "./ceo-demo-mode";
import { buildReportEvidenceSnapshot } from "./report-evidence-snapshot";
import { buildMetricRegistry } from "./report-metric-registry";
import { composeOrionCeoFirst36Deck } from "./compose-orion-ceo-first36-deck";
import { materializeReportAssetImages } from "./materialize-report-assets";
import { inspectCeoFirst36Quality } from "./inspect-ceo-first36-quality";
import { CEO_FIRST_36_SLIDE_COUNT } from "./orion-first-36-slide-registry.v1";
import type { OrionGoldenReportSpec } from "../report-spec/orion-report-spec";
import type { ExecutiveSynthesisOutput } from "../gpt/orion-executive-synthesis-from-sections";
import type { SectionDerivedRiskMatrix } from "../sections/orion-risk-matrix-from-sections";

export class OrionClassicVisualGateError extends Error {
  readonly blockedSections: Array<{ sectionKey: string; reason: string }>;
  constructor(blockedSections: Array<{ sectionKey: string; reason: string }>) {
    super(
      `REQUIRED_VISUAL_ASSET_MISSING: ${blockedSections.map((b) => b.sectionKey).join(", ")}`
    );
    this.name = "OrionClassicVisualGateError";
    this.blockedSections = blockedSections;
  }
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function resolveClientContentPaths(caseId: string): string[] {
  const roots = [
    caseScopedArtifactRoot(ORION_GOLDEN_QA_STORAGE_ROOT, caseId),
    join(process.cwd(), "storage", "digital-profile", "qa-r10-orion-golden-parallel"),
    join(process.cwd(), "storage", "digital-profile", "qa-r10-7-real-subject-calibration"),
  ];
  return roots.map((root) => join(root, "orion-client-content.post-review.json"));
}

export function loadPostReviewClientContent(caseId: string): OrionClientContent {
  for (const path of resolveClientContentPaths(caseId)) {
    const data = readJson<OrionClientContent>(path);
    if (data?.caseId === caseId) return data;
  }
  throw new Error("post-review-client-content-missing");
}

export function shouldUseClassicOrionAuditMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORION_CLASSIC_AUDIT_MODE === "1";
}

export async function runOrionClassicAuditRender(options: {
  caseId: string;
  outputRoot: string;
  clientContent?: OrionClientContent;
}): Promise<{
  caseId: string;
  outputRoot: string;
  slideCount: number;
  pageCount: number;
  verdict: "PASS" | "FAIL";
  clientPolicyStatus: string;
  visualPassed: boolean;
  classicQaPassed: boolean;
  warnings: string[];
  qualityGateStatus?: "completed" | "failed_quality_gate" | "completed_internal_preview_with_warnings";
  ceoDemoMode?: boolean;
}> {
  if (isCeoDemoMode()) {
    return runOrionCeoDemoRender(options);
  }
  const { caseId, outputRoot } = options;
  mkdirSync(outputRoot, { recursive: true });

  const clientContent = options.clientContent ?? loadPostReviewClientContent(caseId);
  const ctx = await loadRealCaseContext(caseId, { locale: "ru", buildFreshReportJson: false });
  const inventory = buildFullEvidenceInventory({
    caseId,
    reportRunId: clientContent.reportRunId,
    ctx,
  });
  const clientFinalize = isClientProductionFinalize();
  const assets = await buildOrionClassicAuditAssets({
    ctx,
    reportRunId: clientContent.reportRunId,
    audience: clientFinalize ? "client" : "internal_preview",
    allowSyntheticSerp: !clientFinalize,
  });
  console.info("[serp-capture] classic audit assets", {
    caseId,
    reportRunId: clientContent.reportRunId,
    liveCount: assets.filter((a) => a.kind === "live_serp").length,
    syntheticCount: assets.filter((a) => a.kind === "synthetic_serp").length,
    capturedCount: assets.filter((a) => a.kind === "captured_serp").length,
    providerCount: assets.filter(
      (a) =>
        a.evidenceRefs.some((r) => r.startsWith("serp_observation:")) ||
        /provider_serp|serper_organic/i.test(a.assetRef)
    ).length,
  });

  // Client reports must not omit required SERP visuals or replace them with text pages.
  if (clientFinalize) {
    const gate = evaluateClassicProviderSerpGate({
      assets,
      requireRu: true,
      requireUae: true,
    });
    if (!gate.allowed) {
      writeJson(join(outputRoot, "visual-asset-gate.json"), gate);
      throw new OrionClassicVisualGateError(gate.blockedSections);
    }
  }

  const roots = [
    caseScopedArtifactRoot(ORION_GOLDEN_QA_STORAGE_ROOT, caseId),
    join(process.cwd(), "storage", "digital-profile", "qa-r10-orion-golden-parallel"),
  ];
  let executiveSynthesis: ExecutiveSynthesisOutput | null = null;
  let riskMatrix: SectionDerivedRiskMatrix | null = null;
  for (const root of roots) {
    executiveSynthesis =
      executiveSynthesis ?? readJson<ExecutiveSynthesisOutput>(join(root, "executive-synthesis.output.json"));
    riskMatrix =
      riskMatrix ?? readJson<SectionDerivedRiskMatrix>(join(root, "risk-matrix.section-derived.json"));
  }

  const themeSet = buildOrionThemeSet({
    inventory,
    subjectName: clientContent.subject.displayName,
    caseId,
    clientContent,
    executiveSynthesis,
  });
  writeJson(join(outputRoot, "orion-theme-set.json"), themeSet);

  const reportSpec = buildOrionClassicReportSpecFromClientContent({
    clientContent,
    inventory,
    assets,
    inventoryCounts: inventory.counts,
    warnings: inventory.warnings,
    executiveSynthesis,
    riskMatrix,
  });
  const deckManifest = composeOrionClassicAuditDeck(reportSpec, assets);

  writeJson(join(outputRoot, "orion-classic-report-spec.json"), reportSpec);
  writeJson(join(outputRoot, "final-deck-manifest.json"), deckManifest);
  writeJson(join(outputRoot, "report-assets.json"), assets);

  const renderResult = await renderOrionGoldenArtifacts({
    reportSpec,
    deckManifest,
    assets,
    pptxOut: join(outputRoot, "rendered-client.pptx"),
    pdfOut: join(outputRoot, "rendered-client.pdf"),
    pagesOut: join(outputRoot, "pages-png"),
  });

  const clientPolicy = inspectOrionGoldenClientPolicy({ reportSpec, deckManifest });
  writeJson(join(outputRoot, "client-policy-inspection.json"), clientPolicy);

  const visual = inspectOrionGoldenVisualQuality({
    outputRoot,
    deckManifest,
    inventory,
    pdfExportMode: renderResult.pdfExportMode,
    reportMode: "classic_orion_audit",
  });
  writeJson(join(outputRoot, "visual-qa-inspection.json"), visual);

  const classicQa = inspectClassicOrionAuditQuality({
    deckManifest,
    reportSpec,
    inventory,
    outputRoot,
    assets,
    clientProductionFinalize: isClientProductionFinalize(),
  });
  writeJson(join(outputRoot, "classic-audit-quality-inspection.json"), classicQa);

  const verdict =
    clientPolicy.passed && visual.passed && classicQa.passed ? "PASS" : "FAIL";

  // Metadata tags are not user-facing failures; surface real QA issues first.
  const metaNoise = new Set([
    "classic_orion_audit_mode",
    "commercial_pack_included",
    "client_audit_render_from_post_review_content",
    "commercial_sections_omitted",
    "r10_9a_visual_polish",
    "source:orion-client-content.post-review",
    "source:orion-client-content.pre-review",
  ]);
  const warnings = [
    ...(clientPolicy.issues ?? []),
    ...classicQa.issues,
    ...visual.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`),
    ...(reportSpec.qaMetadata.warnings ?? []).filter((w) => !metaNoise.has(w)),
  ];

  return {
    caseId,
    outputRoot,
    slideCount: deckManifest.slideCount,
    pageCount: visual.pageCount,
    verdict,
    clientPolicyStatus: clientPolicy.passed ? "PASS" : "FAIL",
    visualPassed: visual.passed,
    classicQaPassed: classicQa.passed,
    warnings,
  };
}

function formatReportDateLabel(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

async function runOrionCeoDemoRender(options: {
  caseId: string;
  outputRoot: string;
  clientContent?: OrionClientContent;
}): Promise<{
  caseId: string;
  outputRoot: string;
  slideCount: number;
  pageCount: number;
  verdict: "PASS" | "FAIL";
  clientPolicyStatus: string;
  visualPassed: boolean;
  classicQaPassed: boolean;
  warnings: string[];
  qualityGateStatus: "completed" | "failed_quality_gate" | "completed_internal_preview_with_warnings";
  ceoDemoMode: true;
}> {
  const { caseId, outputRoot } = options;
  mkdirSync(outputRoot, { recursive: true });

  const clientContent = options.clientContent ?? loadPostReviewClientContent(caseId);
  const ctx = await loadRealCaseContext(caseId, { locale: "ru", buildFreshReportJson: false });
  const reportRunId = clientContent.reportRunId;

  const snapshot = await buildReportEvidenceSnapshot({ caseId, reportRunId, ctx });
  const metrics = buildMetricRegistry(
    snapshot,
    ctx.databaseProfiles.map((p) => ({
      provider: p.provider,
      status: p.reviewStatus ?? p.matchType,
    }))
  );

  writeJson(join(outputRoot, "report-evidence-snapshot.json"), snapshot);
  writeJson(join(outputRoot, "report-metric-registry.json"), metrics);

  const rawAssets = await buildOrionClassicAuditAssets({
    ctx,
    reportRunId,
    audience: "internal_preview",
    allowSyntheticSerp: true,
  });
  const assets = await materializeReportAssetImages({ caseId, assets: rawAssets });
  writeJson(join(outputRoot, "report-assets.json"), assets);

  const deckManifest = composeOrionCeoFirst36Deck({
    subjectName: clientContent.subject.displayName,
    reportRunId,
    snapshot,
    metrics,
    assets,
    reportDateLabel: formatReportDateLabel(clientContent.generatedAt),
  });
  writeJson(join(outputRoot, "final-deck-manifest.json"), deckManifest);

  const reportSpec = {
    subject: {
      displayName: clientContent.subject.displayName,
      reportTitle: "ORION Digital Profile — CEO Demo",
    },
    executiveSummary: {
      globalRiskLevel: "moderate" as const,
      headline: `CEO Demo — ${clientContent.subject.displayName}`,
      narrative: metrics.caveats.join(" "),
      executiveSummary: metrics.caveats.join(" ") || "CEO Demo first-36",
      mainRisks: [],
      finalRecommendations: [],
      nextSteps: [],
    },
    qaMetadata: {
      ceoDemoMode: true,
      reportRunId,
      dataMode: snapshot.dataMode,
      warnings: snapshot.warnings,
    },
    registrySections: [],
  } as unknown as OrionGoldenReportSpec;

  writeJson(join(outputRoot, "orion-ceo-report-spec.json"), reportSpec);

  const renderResult = await renderOrionGoldenArtifacts({
    reportSpec,
    deckManifest,
    assets,
    pptxOut: join(outputRoot, "rendered-client.pptx"),
    pdfOut: join(outputRoot, "rendered-client.pdf"),
    pagesOut: join(outputRoot, "pages-png"),
    ceoDemoMode: true,
  });

  const visual = inspectOrionGoldenVisualQuality({
    outputRoot,
    deckManifest,
    inventory: buildFullEvidenceInventory({
      caseId,
      reportRunId,
      ctx,
    }),
    pdfExportMode: renderResult.pdfExportMode,
    reportMode: "ceo_demo_first36",
  });
  writeJson(join(outputRoot, "visual-qa-inspection.json"), visual);

  const ceoQa = inspectCeoFirst36Quality({
    deckManifest,
    metrics,
    assets,
    outputRoot,
  });
  writeJson(join(outputRoot, "ceo-first36-quality-inspection.json"), ceoQa);

  const clientPolicy = inspectOrionGoldenClientPolicy({ reportSpec, deckManifest });
  writeJson(join(outputRoot, "client-policy-inspection.json"), clientPolicy);

  const verdict =
    ceoQa.passed && visual.passed && deckManifest.slideCount === CEO_FIRST_36_SLIDE_COUNT
      ? "PASS"
      : "FAIL";

  const qualityGateStatus: "completed" | "failed_quality_gate" | "completed_internal_preview_with_warnings" =
    ceoQa.hardFailed
      ? "failed_quality_gate"
      : verdict === "PASS"
        ? "completed"
        : "completed_internal_preview_with_warnings";

  const warnings = [
    ...ceoQa.issues,
    ...visual.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`),
    ...(renderResult.warnings ?? []),
  ];

  return {
    caseId,
    outputRoot,
    slideCount: deckManifest.slideCount,
    pageCount: visual.pageCount,
    verdict,
    clientPolicyStatus: clientPolicy.passed ? "PASS" : "FAIL",
    visualPassed: visual.passed,
    classicQaPassed: ceoQa.passed,
    warnings,
    qualityGateStatus,
    ceoDemoMode: true,
  };
}
