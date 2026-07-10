/**
 * Recovery smoke: CEO first-36 slice gates, client-policy hard blockers, registry contract.
 *
 * Run: npm run smoke:ceo-first36-recovery-quality
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CEO_FIRST_36_SLIDE_COUNT,
  ORION_FIRST_36_SLIDE_REGISTRY_V1,
} from "../src/modules/digital-profile/orion-golden/classic/orion-first-36-slide-registry.v1";
import { composeOrionCeoFirst36Deck } from "../src/modules/digital-profile/orion-golden/classic/compose-orion-ceo-first36-deck";
import { buildMetricRegistry } from "../src/modules/digital-profile/orion-golden/classic/report-metric-registry";
import type { ReportEvidenceSnapshot } from "../src/modules/digital-profile/orion-golden/classic/report-evidence-snapshot";
import { inspectCeoFirst36Quality } from "../src/modules/digital-profile/orion-golden/classic/inspect-ceo-first36-quality";
import { evaluateCeoSliceReadiness } from "../src/modules/digital-profile/orion-golden/classic/ceo-slice-readiness";
import { scanCeoClientTextLeaks, CEO_CLIENT_POLICY_BLOCK_RE } from "../src/modules/digital-profile/orion-golden/classic/ceo-client-labels";
import { filterCeoReportAssets } from "../src/modules/digital-profile/orion-golden/classic/ceo-entity-filter";
import { SYNTHETIC_API_SERP_CAPTION } from "../src/modules/digital-profile/serp-observation";
import type { ReportAssetV1 } from "../src/modules/digital-profile/orion-report-spec/asset-builder";
import { inspectOrionGoldenClientPolicy } from "../src/modules/digital-profile/orion-golden/qa/client-policy-inspection";
import type { OrionGoldenReportSpec } from "../src/modules/digital-profile/orion-golden/report-spec/orion-report-spec";

const SUBJECT = "Глинка Сергей Михайлович";

let failures = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${extra ? ` — ${extra}` : ""}`);
}

function recoverySnapshot(): ReportEvidenceSnapshot {
  const ruObs = Array.from({ length: 12 }, (_, i) => ({
    id: `ru-obs-${i}`,
    queryId: "q-ru",
    queryText: "Глинка Сергей",
    provider: "serper",
    engine: "GOOGLE",
    surface: "organic",
    region: "RU" as const,
    language: "ru",
    rank: i + 1,
    url: `https://example.ru/${i}`,
    title: i === 2 ? "Глинка Сергей — санкции" : `Глинка Сергей Михайлович — публикация ${i}`,
    snippet: "snippet",
    domain: "example.ru",
    providerStatus: "OK",
    capturedAt: new Date().toISOString(),
  }));
  const uaeObs = Array.from({ length: 4 }, (_, i) => ({
    id: `uae-obs-${i}`,
    queryId: "q-uae",
    queryText: "Sergey Glinka",
    provider: "serper",
    engine: "GOOGLE",
    surface: "organic",
    region: "UAE" as const,
    language: "en",
    rank: i + 1,
    url: `https://example.ae/${i}`,
    title: `Sergey Glinka profile ${i}`,
    snippet: "snippet",
    domain: "example.ae",
    providerStatus: "OK",
    capturedAt: new Date().toISOString(),
  }));

  const suggestions = Array.from({ length: 10 }, (_, i) => ({
    id: `sug-${i}`,
    surfaceType: "SUGGESTION",
    query: `глинка сергей ${i}`,
    region: "RU" as const,
    title: `глинка сергей ${i}`,
    snippet: null,
    url: null,
    imageUrl: null,
    thumbnailUrl: null,
    evidenceRef: `surface:sug-${i}`,
  }));

  const related = Array.from({ length: 8 }, (_, i) => ({
    id: `rel-${i}`,
    surfaceType: "RELATED_QUERY",
    query: `глинка биография ${i}`,
    region: "RU" as const,
    title: `глинка биография ${i}`,
    snippet: null,
    url: null,
    imageUrl: null,
    thumbnailUrl: null,
    evidenceRef: `surface:rel-${i}`,
  }));

  return {
    reportRunId: "run-recovery-smoke",
    caseId: "case-recovery",
    dataMode: "RUN_SCOPED",
    coverage: { status: "COMPLETE", pct: 100, observedOrganic: 16, expectedOrganic: 16 },
    observations: [...ruObs, ...uaeObs],
    surfaces: [...suggestions, ...related],
    wikiStatus: "ABSENT",
    warnings: [],
  };
}

function recoveryAssets(): ReportAssetV1[] {
  const ruImages = Array.from({ length: 14 }, (_, i) => ({
    assetRef: `media_RU_google_image_${i}`,
    kind: "image_grid" as const,
    title: `Глинка Сергей Михайлович фото ${i}`,
    imageData: "img",
    region: "RU" as const,
    provider: "google",
    surface: "image_grid",
    evidenceRefs: [],
    status: "ready" as const,
  }));
  const uaeImages = Array.from({ length: 4 }, (_, i) => ({
    assetRef: `media_UAE_google_image_${i}`,
    kind: "image_grid" as const,
    title: `Sergey Glinka UAE ${i}`,
    imageData: "img",
    region: "UAE" as const,
    provider: "google",
    surface: "image_grid",
    evidenceRefs: [],
    status: "ready" as const,
  }));
  return [
    {
      assetRef: "ru_provider_serp_google_x",
      kind: "synthetic_serp",
      title: "Google — Глинка",
      caption: SYNTHETIC_API_SERP_CAPTION,
      imageData: "abc",
      region: "RU",
      provider: "serper",
      surface: "organic",
      evidenceRefs: ["serp_observation:ru-obs-0"],
      status: "ready",
    },
    {
      assetRef: "uae_provider_serp_google_x",
      kind: "synthetic_serp",
      title: "Google — Sergey Glinka",
      caption: SYNTHETIC_API_SERP_CAPTION,
      imageData: "abc",
      region: "UAE",
      provider: "serper",
      surface: "organic",
      evidenceRefs: ["serp_observation:uae-obs-0"],
      status: "ready",
    },
    ...ruImages,
    ...uaeImages,
    {
      assetRef: "ru_knowledge_panel_0",
      kind: "knowledge_panel",
      title: "Глинка Сергей — панель знаний",
      caption: "Сводка по персоне",
      imageData: "kg",
      region: "RU",
      provider: "google",
      surface: "knowledge_panel",
      evidenceRefs: [],
      status: "ready",
    },
  ];
}

function sliceContactSheets(slides: { pageNumber: number; sectionKey: string }[]) {
  return {
    S1_1_10: slides.filter((s) => s.pageNumber >= 1 && s.pageNumber <= 10).map((s) => s.pageNumber),
    S2_11_22: slides.filter((s) => s.pageNumber >= 11 && s.pageNumber <= 22).map((s) => s.pageNumber),
    S3_23_32: slides.filter((s) => s.pageNumber >= 23 && s.pageNumber <= 32).map((s) => s.pageNumber),
    S4_33_36: slides.filter((s) => s.pageNumber >= 33 && s.pageNumber <= 36).map((s) => s.pageNumber),
  };
}

function main() {
  console.log("Smoke: CEO first-36 recovery quality\n");

  check("registry count", ORION_FIRST_36_SLIDE_REGISTRY_V1.length === CEO_FIRST_36_SLIDE_COUNT);
  check(
    "no commercial tail",
    !ORION_FIRST_36_SLIDE_REGISTRY_V1.some((e) =>
      ["offer", "product_overview", "about"].includes(e.sectionKey)
    )
  );

  check("client-policy regex armed", CEO_CLIENT_POLICY_BLOCK_RE.test("NAMESAKE_OR_OTHER_ENTITY"));
  check(
    "leak scan catches enum",
    scanCeoClientTextLeaks(["POSSIBLE_MATCH in body"]).length > 0
  );
  check(
    "leak scan clean on RU label",
    scanCeoClientTextLeaks(["Предварительное совпадение — не является подтверждённым риском"]).length === 0
  );

  const snapshot = recoverySnapshot();
  const metrics = buildMetricRegistry(snapshot, [], SUBJECT);
  const assets = filterCeoReportAssets(SUBJECT, recoveryAssets());

  check("RU matrix rows", metrics.ru.matrixRows.length >= 5, `${metrics.ru.matrixRows.length}`);
  check("RU image pool", assets.filter((a) => a.region === "RU" && a.kind === "image_grid").length >= 12);

  const deck = composeOrionCeoFirst36Deck({
    subjectName: SUBJECT,
    reportRunId: snapshot.reportRunId,
    snapshot,
    metrics,
    assets,
    reportDateLabel: "10 июля 2026 г.",
  });

  check("deck slideCount", deck.slideCount === 36);
  check(
    "footer date in ceoMeta",
    deck.finalSlides.every((s) => s.ceoMeta?.reportDateLabel === "10 июля 2026 г.")
  );
  check(
    "no raw runId in slide copy",
    !deck.finalSlides.some((s) =>
      [s.title, s.narrative ?? "", ...(s.bullets ?? [])].some((t) => /orion-r10-|RUN_SCOPED/i.test(t))
    )
  );

  const sliceReadiness = evaluateCeoSliceReadiness({
    deckManifest: deck,
    metrics,
    assets,
    subjectName: SUBJECT,
  });
  check(
    "slice hard gates",
    !sliceReadiness.checks.some((c) => c.hard && !c.passed),
    sliceReadiness.checks.filter((c) => c.hard && !c.passed).map((c) => c.id).join(", ")
  );
  check("slice S1 PASS", sliceReadiness.sliceStatus.S1_1_10 === "PASS");
  check("slice S2 PASS", sliceReadiness.sliceStatus.S2_11_22 === "PASS");
  check("slice S3 PASS", sliceReadiness.sliceStatus.S3_23_32 === "PASS");

  const qa = inspectCeoFirst36Quality({
    deckManifest: deck,
    metrics,
    assets,
    sliceReadiness,
  });
  check("ceo QA hard blockers", !qa.hardFailed, qa.issues.filter((_, i) => qa.checks[i]?.hard).join("; "));

  const reportSpec = {
    subject: { displayName: SUBJECT, reportTitle: "ORION Digital Profile" },
    executiveSummary: { headline: "test", narrative: "test", mainRisks: [], finalRecommendations: [], nextSteps: [] },
    qaMetadata: { ceoDemoMode: true },
    registrySections: [],
  } as unknown as OrionGoldenReportSpec;
  const clientPolicy = inspectOrionGoldenClientPolicy({ reportSpec, deckManifest: deck });
  check("client policy", clientPolicy.passed, clientPolicy.issues.slice(0, 3).join("; "));

  const contactSheets = sliceContactSheets(deck.finalSlides);
  check("contact sheet S1", contactSheets.S1_1_10.length === 10);
  check("contact sheet S2", contactSheets.S2_11_22.length === 12);
  check("contact sheet S3", contactSheets.S3_23_32.length === 10);
  check("contact sheet S4", contactSheets.S4_33_36.length === 4);

  const outDir = join(process.cwd(), "storage", "digital-profile", "qa-ceo-first36-recovery");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "recovery-qa-result.json"),
    `${JSON.stringify(
      {
        failures,
        sliceReadiness,
        qa,
        contactSheets,
        clientPolicy,
        blockedSlides: deck.finalSlides.filter((s) => s.ceoMeta?.readiness === "blocked").map((s) => s.pageNumber),
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
  console.log(`\nWrote ${join(outDir, "recovery-qa-result.json")}`);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll CEO first-36 recovery smoke checks passed.");
}

main();
