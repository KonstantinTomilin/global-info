/**
 * Offline smoke: CEO demo first-36 registry, composer, metrics, QA gate.
 *
 * Run: npm run smoke:ceo-demo-report-quality
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
import { SYNTHETIC_API_SERP_CAPTION } from "../src/modules/digital-profile/serp-observation";
import type { ReportAssetV1 } from "../src/modules/digital-profile/orion-report-spec/asset-builder";

let failures = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${extra ? ` — ${extra}` : ""}`);
}

function legacySnapshot(): ReportEvidenceSnapshot {
  return {
    reportRunId: "run-smoke-ceo",
    caseId: "case-smoke",
    dataMode: "LEGACY_CASE_SCOPE",
    coverage: { status: "INCOMPLETE", pct: null, observedOrganic: 5, expectedOrganic: 20 },
    observations: [],
    surfaces: [
      {
        id: "s1",
        surfaceType: "SUGGESTION",
        query: "тест",
        region: "RU",
        title: "подсказка",
        snippet: null,
        url: null,
        imageUrl: null,
        thumbnailUrl: null,
        evidenceRef: "surface:s1",
      },
    ],
    wikiStatus: "NAMESAKE_OR_OTHER_ENTITY",
    warnings: ["LEGACY_CASE_SCOPE"],
  };
}

function runScopedSnapshot(): ReportEvidenceSnapshot {
  const observations = Array.from({ length: 12 }, (_, i) => ({
    id: `obs-${i}`,
    queryId: "q1",
    queryText: "Глинка Сергей",
    provider: "serper",
    engine: "GOOGLE",
    surface: "organic",
    region: "RU",
    language: "ru",
    rank: i + 1,
    url: `https://example.com/${i}`,
    title: i === 3 ? "санкции список" : `Результат ${i}`,
    snippet: "snippet",
    domain: "example.com",
    providerStatus: "OK",
    capturedAt: new Date().toISOString(),
  }));
  return {
    reportRunId: "run-smoke-ceo",
    caseId: "case-smoke",
    dataMode: "RUN_SCOPED",
    coverage: { status: "COMPLETE", pct: 100, observedOrganic: 12, expectedOrganic: 12 },
    observations,
    surfaces: [],
    wikiStatus: "ABSENT",
    warnings: [],
  };
}

function main() {
  console.log("Smoke: CEO demo first-36 report quality\n");

  check("registry count", ORION_FIRST_36_SLIDE_REGISTRY_V1.length === CEO_FIRST_36_SLIDE_COUNT);
  check(
    "registry pages 1..36",
    ORION_FIRST_36_SLIDE_REGISTRY_V1.every((e, i) => e.referencePage === i + 1)
  );
  check(
    "no commercial keys",
    !ORION_FIRST_36_SLIDE_REGISTRY_V1.some((e) =>
      ["offer", "product_overview", "about"].includes(e.sectionKey)
    )
  );
  check(
    "no world-check slide",
    !ORION_FIRST_36_SLIDE_REGISTRY_V1.some((e) => /world.?check/i.test(e.sectionKey))
  );

  const assets: ReportAssetV1[] = [
    {
      assetRef: "ru_provider_serp_google_x",
      kind: "synthetic_serp",
      title: "Google — Глинка",
      caption: SYNTHETIC_API_SERP_CAPTION,
      imageData: "abc",
      region: "RU",
      provider: "serper",
      surface: "organic",
      evidenceRefs: ["serp_observation:obs-0"],
      status: "ready",
    },
    {
      assetRef: "media_RU_google_image_abc",
      kind: "image_grid",
      title: "Фото",
      imageData: "img",
      region: "RU",
      provider: "google",
      surface: "image_grid",
      evidenceRefs: [],
      status: "ready",
    },
  ];

  const legacyMetrics = buildMetricRegistry(legacySnapshot());
  check("legacy adversePct null", legacyMetrics.ru.adversePct === null);
  check(
    "legacy caveat",
    legacyMetrics.caveats.some((c) => /доля не рассчитывается/i.test(c))
  );

  const runMetrics = buildMetricRegistry(runScopedSnapshot());
  check("run-scoped adversePct", runMetrics.ru.adversePct != null);

  const deck = composeOrionCeoFirst36Deck({
    subjectName: "Глинка Сергей Михайлович",
    reportRunId: "run-smoke-ceo",
    snapshot: runScopedSnapshot(),
    metrics: runMetrics,
    assets,
    reportDateLabel: "10 июля 2026 г.",
  });

  check("deck slideCount", deck.slideCount === 36);
  check(
    "page 10 SERP asset",
    Boolean(deck.finalSlides[9]?.assetRefs?.includes("ru_provider_serp_google_x"))
  );
  check(
    "matrix no dash rank",
    !(deck.finalSlides[8]?.bullets ?? []).some((b) => /#\s*—/.test(b))
  );

  const qa = inspectCeoFirst36Quality({
    deckManifest: deck,
    metrics: runMetrics,
    assets,
  });
  check("ceo QA hard gates", !qa.hardFailed, qa.issues.join("; "));
  check("visual template floor", qa.visualTemplateCount >= 24, `${qa.visualTemplateCount}`);

  const outDir = join(process.cwd(), "storage", "digital-profile", "qa-ceo-demo-first36");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "qa-result.json"),
    `${JSON.stringify({ failures, deckSlideCount: deck.slideCount, qa }, null, 2)}\n`,
    "utf-8"
  );
  console.log(`\nWrote ${join(outDir, "qa-result.json")}`);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll CEO demo smoke checks passed.");
}

main();
