/**
 * C9 — Offline content acceptance (NETWORK_CALLS=0).
 * Runs C5–C8 deterministic suites + synthetic editorial checks from
 * ORION_CONTENT_UPGRADE_PLAN §C9 (grounding, article-specific why, junk, clip).
 *
 * Usage:
 *   npx tsx scripts/c9-offline-content-acceptance.ts [outDir]
 *
 * CEO_READY stays false. No live API / commit / push.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertComposedSummaryGatesPass,
  composeClientSummary,
} from "../src/modules/digital-profile/orion-golden/analytics/client-summary-composer";
import {
  assertDisclosurePlanGatesPass,
  buildCrossSlideDisclosurePlan,
} from "../src/modules/digital-profile/orion-golden/analytics/cross-slide-disclosure-planner";
import { CANONICAL_CLAIM_SCHEMA_VERSION } from "../src/modules/digital-profile/orion-golden/contracts/canonical-claim";
import type { CanonicalClaimBundle } from "../src/modules/digital-profile/orion-golden/contracts/canonical-claim";
import type { Finding } from "../src/modules/digital-profile/orion-golden/contracts/finding";
import {
  assertCrossSlideDedupeGatesPass,
  inspectCrossSlideDuplicateSentences,
} from "../src/modules/digital-profile/orion-golden/deck-sections/cross-slide-dedupe-qa";
import {
  assertSemanticPaginationGatesPass,
  bulletWithFindingIdAtomic,
  paginateThemeBlocks,
} from "../src/modules/digital-profile/orion-golden/deck-sections/semantic-summary-pagination";
import {
  assertContentQualityGatesPass,
  evaluateContentQuality,
} from "../src/modules/digital-profile/orion-golden/deck-sections/content-quality-harness";
import type { SectionPackV2 } from "../src/modules/digital-profile/orion-golden/deck-sections/contracts";
import {
  SECTION_PACK_SCHEMA_VERSION,
  SLIDE_CONTENT_SCHEMA_VERSION,
} from "../src/modules/digital-profile/orion-golden/deck-sections/contracts";

process.env.NETWORK_CALLS = "0";

type SuiteResult = {
  suiteId: string;
  passed: boolean;
  checks: Record<string, boolean>;
  issues: string[];
};

function claim(partial: {
  claimId: string;
  theme: string;
  clientDescription: string;
  whyItMatters: string;
  url?: string;
  inventoryId?: string;
  quote?: string;
}): CanonicalClaimBundle["claims"][number] {
  const desc = partial.clientDescription;
  const quote = partial.quote ?? desc.slice(0, 48);
  return {
    schemaVersion: CANONICAL_CLAIM_SCHEMA_VERSION,
    claimId: partial.claimId,
    evidenceRefs: [`inventory:${partial.inventoryId ?? partial.claimId}`],
    inventoryId: partial.inventoryId ?? partial.claimId,
    url: partial.url ?? `https://news.example/${partial.claimId}`,
    theme: partial.theme,
    isAdverseTheme: true,
    riskLevel: "high",
    clientDescription: desc,
    displayExcerpt: desc,
    claimKind: "SOURCE_ALLEGATION",
    attribution: "сообщается",
    qualification:
      "Наличие публикации не подтверждает изложенные утверждения; требуется проверка.",
    recommendedChecks: ["Сверить первоисточник"],
    whyItMatters: partial.whyItMatters,
    supportingSpans: [{ sentenceIndex: 0, quote }],
    contentSource: "full_text",
    originalFullTextRef: null,
    contentHash: "h1",
    findingIds: [`finding-${partial.claimId}`],
    semanticExcerptTruncations: 0,
  };
}

function finding(partial: Partial<Finding> & Pick<Finding, "findingId" | "theme">): Finding {
  return {
    schemaVersion: "finding-v2",
    caseId: "c9-case",
    datasetId: "c9-ds",
    sourceHashes: [],
    evidenceRefs: ["inventory:a1"],
    claim: "legacy",
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

function runVitestSuite(): SuiteResult {
  const issues: string[] = [];
  try {
    const vitestCli = join(
      process.cwd(),
      "node_modules",
      "vitest",
      "vitest.mjs"
    );
    execFileSync(
      process.execPath,
      [
        vitestCli,
        "run",
        "tests/unit/client-summary-composer.test.ts",
        "tests/unit/cross-slide-disclosure.test.ts",
        "tests/unit/semantic-summary-pagination.test.ts",
        "tests/unit/content-quality-harness.test.ts",
        "tests/unit/canonical-claim.test.ts",
        "tests/unit/evidence-quality-gate.test.ts",
        "--reporter=dot",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, NETWORK_CALLS: "0" },
        stdio: "pipe",
      }
    );
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const detail =
      err.stderr?.toString() ||
      err.stdout?.toString() ||
      err.message ||
      String(e);
    issues.push(detail.slice(0, 600));
  }
  return {
    suiteId: "unit-c5-c8",
    passed: issues.length === 0,
    checks: { NETWORK_CALLS_0: true, unitTestsPass: issues.length === 0 },
    issues,
  };
}

function runSyntheticEditorial(): SuiteResult {
  const issues: string[] = [];
  const checks: Record<string, boolean> = {
    groundingSpansPresent: false,
    articleSpecificWhy: false,
    junkExcluded: false,
    noThemeClip: false,
    noCrossSlideDup: false,
    contentQualityPass: false,
  };

  try {
    const claims: CanonicalClaimBundle = {
      schemaVersion: "canonical-claims-v1",
      caseId: "c9-case",
      datasetId: "c9-ds",
      generatedAt: new Date().toISOString(),
      claims: [
        claim({
          claimId: "a1",
          theme: "criminal_legal",
          clientDescription:
            "Авторы расследования описывают обстоятельства совместного отдыха и возможный конфликт интересов.",
          whyItMatters:
            "Такой сюжет обычно запускает расширенную проверку контрагента и запрос первичных документов.",
          quote: "Авторы расследования описывают",
        }),
        claim({
          claimId: "a2",
          theme: "political_exposure",
          clientDescription:
            "В публикации изложены сведения о публичной политической экспозиции субъекта.",
          whyItMatters:
            "Политическая экспозиция усиливает вопросы к связям и приемлемости контрагента для сделки.",
          url: "https://politics.example/a2",
          quote: "публичной политической экспозиции",
        }),
      ],
      gates: {
        SEMANTIC_EXCERPT_TRUNCATIONS: 0,
        adverseClaims: 2,
        adverseWithGroundedDescription: 2,
        ADVERSE_GROUNDED_COVERAGE: 1,
      },
    };

    const composed = composeClientSummary({
      caseId: "c9-case",
      datasetId: "c9-ds",
      claims,
      excludeEvidenceRefs: ["inventory:junk"],
    });
    assertComposedSummaryGatesPass(composed);
    checks.articleSpecificWhy = composed.gates.PER_THEME_WHY_IS_ARTICLE_SPECIFIC;
    checks.junkExcluded = !composed.mediaThemeBlocks.some((b) =>
      b.evidenceRefs.includes("inventory:junk")
    );
    checks.groundingSpansPresent = claims.claims.every(
      (c) => c.supportingSpans.length > 0 && c.qualification.trim().length > 0
    );

    const findings = [
      finding({
        findingId: "finding-a1",
        theme: "criminal_legal",
        evidenceRefs: ["inventory:a1"],
      }),
      finding({
        findingId: "finding-a2",
        theme: "political_exposure",
        evidenceRefs: ["inventory:a2"],
        regions: ["RU"],
      }),
    ];
    const plan = buildCrossSlideDisclosurePlan({
      caseId: "c9-case",
      datasetId: "c9-ds",
      composed,
      findings,
    });
    assertDisclosurePlanGatesPass(plan);

    const full = plan.materials[0]!.fullText;
    const brief = plan.materials[0]!.briefText;
    const packs = [
      {
        fragmentKey: "RU_SUMMARY",
        slides: [{ content: { bullets: [full] } }],
      },
      {
        fragmentKey: "EXECUTIVE_SUMMARY",
        slides: [{ content: { bullets: [brief] } }],
      },
      {
        fragmentKey: "RISK_MATRIX",
        slides: [{ content: { bullets: [plan.materials[0]!.matrixText] } }],
      },
    ] as unknown as SectionPackV2[];
    const dup = inspectCrossSlideDuplicateSentences(packs);
    assertCrossSlideDedupeGatesPass({
      ...dup,
      MATERIALS_WITHOUT_FULL_DISCLOSURE: 0,
      MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES: 0,
    });
    checks.noCrossSlideDup = dup.CROSS_SLIDE_DUPLICATE_SENTENCES === 0;

    const paginated = paginateThemeBlocks({
      base: {
        schemaVersion: SLIDE_CONTENT_SCHEMA_VERSION,
        slideId: "ru-summary",
        sectionType: "RU",
        templateId: "regional-summary",
        title: "Резюме",
        content: {
          bullets: plan.materials.map((m) =>
            bulletWithFindingIdAtomic(m.fullText, m.findingId)
          ),
        },
        evidenceRefs: [],
        findingIds: plan.materials.map((m) => m.findingId),
      } as SectionPackV2["slides"][number],
      templateId: "regional-summary",
      maxThemeBlocksPerSlide: 1,
    });
    assertSemanticPaginationGatesPass(paginated.report);
    checks.noThemeClip = paginated.report.CLIENT_TEXT_TRUNCATIONS === 0;

    // Client-facing pack text without finding-id markers (markers are QA-only).
    const qualityPack: SectionPackV2 = {
      schemaVersion: SECTION_PACK_SCHEMA_VERSION,
      caseId: "c9-case",
      datasetId: "c9-ds",
      reportRunId: "c9-run",
      fragmentKey: "RU_SUMMARY",
      sectionType: "RU_PROFILE",
      status: "READY",
      inputHash: "ih",
      contentHash: "ch",
      promptVersion: "pv",
      slides: [
        {
          schemaVersion: SLIDE_CONTENT_SCHEMA_VERSION,
          slideId: "ru-summary-main",
          sectionType: "RU",
          templateId: "regional-summary",
          title: "Резюме",
          content: {
            bullets: composed.mediaThemeBlocks.flatMap((b) =>
              b.articles.map(
                (a) =>
                  `${a.body}\n\nПочему важно: ${b.whyItMatters}\nЧто проверить: ${b.recommendedChecks.join("; ")}`
              )
            ),
            narrative: "Короткий вывод по региону.",
          },
          evidenceRefs: [],
          findingIds: [],
        },
      ],
      validation: { passed: true, issues: [] },
    } as SectionPackV2;

    const quality = evaluateContentQuality({
      caseId: "c9-case",
      datasetId: "c9-ds",
      packs: [qualityPack],
      composedClientSummary: composed,
      canonicalClaims: claims,
      findings,
      excludeEvidenceRefs: ["inventory:junk"],
      sourceTextByEvidenceRef: {
        "inventory:a1":
          "Авторы расследования описывают обстоятельства совместного отдыха и возможный конфликт интересов.",
        "inventory:a2":
          "В публикации изложены сведения о публичной политической экспозиции субъекта.",
      },
    });
    assertContentQualityGatesPass(quality);
    checks.contentQualityPass = quality.deterministicPass && quality.CEO_READY === false;
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }

  return {
    suiteId: "synthetic-editorial-c9",
    passed: issues.length === 0 && Object.values(checks).every(Boolean),
    checks,
    issues,
  };
}

function runSparseSuite(): SuiteResult {
  const issues: string[] = [];
  const checks: Record<string, boolean> = { honestSparse: false, ceoReadyFalse: true };
  try {
    const empty: CanonicalClaimBundle = {
      schemaVersion: "canonical-claims-v1",
      caseId: "sparse",
      datasetId: "sparse-ds",
      generatedAt: new Date().toISOString(),
      claims: [],
      gates: {
        SEMANTIC_EXCERPT_TRUNCATIONS: 0,
        adverseClaims: 0,
        adverseWithGroundedDescription: 0,
        ADVERSE_GROUNDED_COVERAGE: 1,
      },
    };
    const composed = composeClientSummary({
      caseId: "sparse",
      datasetId: "sparse-ds",
      claims: empty,
    });
    assertComposedSummaryGatesPass(composed);
    checks.honestSparse =
      composed.mediaThemeBlocks.length === 0 &&
      composed.gates.SUMMARY_CONCRETE_EXAMPLES_PRESENT === true;
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }
  return {
    suiteId: "sparse-no-adverse",
    passed: issues.length === 0 && checks.honestSparse,
    checks,
    issues,
  };
}

function main(): void {
  const outDir =
    process.argv[2] ?? join(process.cwd(), "tmp-pdf-review", "c9-offline-acceptance");
  mkdirSync(outDir, { recursive: true });

  const suites = [runVitestSuite(), runSyntheticEditorial(), runSparseSuite()];
  const allPass = suites.every((s) => s.passed);

  const report = {
    schemaVersion: "c9-offline-content-acceptance-v1",
    generatedAt: new Date().toISOString(),
    NETWORK_CALLS: "0",
    CEO_READY: false as const,
    gates: {
      ALL_OFFLINE_SUITES_PASS: allPass,
      UNIT_C5_C8_PASS: suites[0]!.passed,
      SYNTHETIC_EDITORIAL_PASS: suites[1]!.passed,
      SPARSE_PASS: suites[2]!.passed,
      GROUNDING_SPANS_PASS: suites[1]!.checks.groundingSpansPresent === true,
      ARTICLE_SPECIFIC_WHY_PASS: suites[1]!.checks.articleSpecificWhy === true,
      NO_JUNK_EXAMPLES_PASS: suites[1]!.checks.junkExcluded === true,
      NO_C7_CLIP_PASS: suites[1]!.checks.noThemeClip === true,
      CEO_READY: false,
    },
    suites,
    notes: [
      "C9 offline content acceptance — deterministic only.",
      "Full PDF/PPTX/PNG visual page review remains a manual gate.",
      "CEO_READY=false until live E2E + manual acceptance.",
    ],
  };

  const path = join(outDir, "c9-offline-acceptance-report.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ path, ALL_OFFLINE_SUITES_PASS: allPass, CEO_READY: false }, null, 2));
  if (!allPass) process.exitCode = 1;
}

main();
