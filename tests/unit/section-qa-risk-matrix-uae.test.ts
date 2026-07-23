/**
 * Live Deripaska (DPA-2026-0011) failed assembly with:
 *   EXECUTIVE/RISK_MATRIX:FAILED; UAE_PROFILE/UAE_SUMMARY:FAILED
 * Root causes covered here:
 * - RISK_MATRIX stacked GPT keyRisk explanation onto matrixText → bullet >900
 * - UAE_SUMMARY full-disclosure bullets are intentionally long (C6/C7) and
 *   must not fail the generic 900-char section QA bullet budget
 */

import { describe, expect, it } from "vitest";
import { buildRiskMatrixFragment } from "../../src/modules/digital-profile/orion-golden/deck-sections/fragment-builders/executive";
import { buildRegionalSummaryFragment } from "../../src/modules/digital-profile/orion-golden/deck-sections/fragment-builders/regional-summary";
import { validateSectionPack } from "../../src/modules/digital-profile/orion-golden/deck-sections/section-validation";
import type { SectionPackV2 } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";
import type { Finding } from "../../src/modules/digital-profile/orion-golden/contracts/finding";
import type { ScopedFragmentInput } from "../../src/modules/digital-profile/orion-golden/deck-sections/scoped-input";
import type { CrossSlideDisclosurePlan } from "../../src/modules/digital-profile/orion-golden/contracts/cross-slide-disclosure-plan";
import { CROSS_SLIDE_DISCLOSURE_PLAN_VERSION } from "../../src/modules/digital-profile/orion-golden/contracts/cross-slide-disclosure-plan";
import { getClientTextFieldBudgets } from "../../src/modules/digital-profile/orion-golden/client/load-client-text-contract";
import { SECTION_PACK_SCHEMA_VERSION } from "../../src/modules/digital-profile/orion-golden/deck-sections/contracts";

function finding(partial: Partial<Finding> & Pick<Finding, "findingId" | "theme">): Finding {
  return {
    schemaVersion: "finding-v2",
    caseId: "c",
    datasetId: "d",
    sourceHashes: [],
    evidenceRefs: ["inventory:1"],
    claim: "legacy claim",
    subjectMatch: "SUBJECT_MATCH",
    riskLevel: "high",
    confidence: 0.9,
    regions: ["UAE"],
    sourceDomains: ["news.example"],
    providers: ["serper"],
    recommendedAction: "Сверить первоисточник и запросить документы.",
    contradictions: [],
    limitations: [],
    promotionPriority: "P1",
    ...partial,
  };
}

function scoped(findings: Finding[]): ScopedFragmentInput {
  return {
    subject: { displayName: "Test", aliases: [] },
    findings,
    surfaceUnits: [],
    metricSnapshot: {
      metricSnapshotId: "m1",
      datasetId: "d",
      reportRunId: "r1",
      baseCount: 1,
      enrichmentCount: 0,
      compositeCount: 10,
      subjectMatchCount: findings.length,
      likelySubjectCount: 0,
      ambiguousCount: 0,
      otherSubjectCount: 0,
      adverseFindingCount: findings.length,
      perRegionCounts: { UAE: 10, RU: 0 },
    },
    scope: {
      regions: ["UAE"],
      surfaces: [],
      unitSurfaces: ["url_audit"],
      subjectMatch: ["SUBJECT_MATCH"],
      findingIds: null,
    },
    evidenceIndex: {
      "inventory:1": { domain: "news.example", kind: "organic", region: "UAE" },
    },
  };
}

function asPack(
  fragmentKey: SectionPackV2["fragmentKey"],
  output: { slides: SectionPackV2["slides"]; status: SectionPackV2["status"] },
  scopedIn: ScopedFragmentInput
): SectionPackV2 {
  const evidenceRefs = Object.keys(scopedIn.evidenceIndex);
  return {
    schemaVersion: SECTION_PACK_SCHEMA_VERSION,
    sectionId: fragmentKey.startsWith("UAE_") ? "UAE_PROFILE" : "EXECUTIVE",
    sectionType: fragmentKey.startsWith("UAE_") ? "UAE_PROFILE" : "EXECUTIVE",
    fragmentKey,
    caseId: "c",
    datasetId: "d",
    reportRunId: "r1",
    sourceDatasetId: "d",
    contentVersion: "test",
    promptVersion: "test",
    contentHash: "h",
    inputHash: "i",
    generatedAt: new Date().toISOString(),
    required: true,
    status: output.status,
    sourceFindingIds: scopedIn.findings.map((f) => f.findingId),
    evidenceRefs,
    inputs: {
      findingIds: scopedIn.findings.map((f) => f.findingId),
      evidenceRefs,
      metricSnapshotId: "m1",
    },
    slides: output.slides,
    metrics: {
      datasetCount: evidenceRefs.length,
      displayedCount: evidenceRefs.length,
      adverseDatasetCount: 1,
      adverseDisplayedCount: 1,
    },
    provenance: { providers: [], reportRunIds: ["r1"], evidenceRefs },
    validation: { passed: true, issues: [] },
  } as SectionPackV2;
}

describe("section QA — RISK_MATRIX + UAE_SUMMARY live gates", () => {
  it("keeps RISK_MATRIX bullets under budget when GPT keyRisks have long explanations", () => {
    const f = finding({
      findingId: "finding-criminal_legal-subject_match-aaaa",
      theme: "Криминальные / судебные материалы",
      regions: ["RU"],
    });
    const plan: CrossSlideDisclosurePlan = {
      schemaVersion: CROSS_SLIDE_DISCLOSURE_PLAN_VERSION,
      caseId: "c",
      datasetId: "d",
      generatedAt: new Date().toISOString(),
      materials: [
        {
          findingId: f.findingId,
          themeId: "criminal_legal",
          themeLabel: f.theme,
          evidenceRefs: f.evidenceRefs,
          fullOwnerFragment: "RU_SUMMARY",
          fullText: "x".repeat(1200),
          briefText: "Кратко о теме.",
          matrixText:
            "Матрица риска: тема «Криминальные / судебные материалы» требует отдельной проверки (сигналы: news.example).\nПриоритет матрицы: уточнить первичные документы в тематическом резюме (без повтора полного текста).",
          surfaceAngles: {
            serp: "serp",
            images: "images",
            suggestions: "suggestions",
          },
        },
      ],
      gates: {
        MATERIALS_WITHOUT_FULL_DISCLOSURE: 0,
        MATERIALS_WITH_MULTIPLE_FULL_OWNERS: 0,
        CROSS_SLIDE_DUPLICATE_SENTENCES: 0,
      },
    };
    const longExplanation = (
      "В открытых источниках тема сопровождается развёрнутым описанием процессуальных рисков, " +
      "упоминаниями связанных лиц и корпоративных структур, а также повторными публикациями, " +
      "которые при первичной банковской проверке обычно запускают расширенный due diligence и " +
      "запрос первичных судебных документов у контрагента. "
    ).repeat(3);
    expect(longExplanation.length).toBeGreaterThan(400);

    const out = buildRiskMatrixFragment("EXECUTIVE", scoped([f]), {
      crossSlideDisclosurePlan: plan,
      gptCaseAnalysis: {
        overallRiskLevel: "high",
        executiveConclusion: "Есть существенные риск-сигналы.",
        keyRisks: [
          {
            theme: "Судебные и криминальные упоминания",
            severity: "high",
            explanation: longExplanation,
            advice:
              "Запросить актуальные судебные документы и сверить идентификацию фигуранта с проверяемым лицом.",
          },
        ],
        positiveSignals: [],
        recommendations: [],
      },
    });

    const budget = getClientTextFieldBudgets().bullet;
    for (const slide of out.slides) {
      for (const b of slide.content.bullets ?? []) {
        expect(b.length, b.slice(0, 80)).toBeLessThanOrEqual(budget);
        expect(b).not.toContain(longExplanation.slice(0, 80));
        expect(b).toMatch(/Что делать:/u);
      }
    }

    const pack = asPack("RISK_MATRIX", out, scoped([f]));
    const report = validateSectionPack({
      pack,
      expectedCaseId: "c",
      expectedReportRunId: "r1",
      expectedDatasetId: "d",
      bundle: { findings: [f] } as never,
      knownEvidenceRefs: new Set(["inventory:1"]),
      evidenceIndex: scoped([f]).evidenceIndex,
    });
    expect(report.passed, report.issues.join("; ")).toBe(true);
  });

  it("does not fail UAE_SUMMARY when full-disclosure theme bullet exceeds 900 chars", () => {
    const f = finding({
      findingId: "finding-sanctions-subject_match-bbbb",
      theme: "Санкции / контрольные списки",
      regions: ["UAE", "INTERNATIONAL"],
    });
    const fullText =
      "По теме «Санкции / контрольные списки» в международном контуре видны публикации, " +
      "которые формируют устойчивый риск-сигнал при проверке контрагента.\n\n" +
      "В материале news.example сообщается о связанных структурах и повторных упоминаниях.\n\n" +
      "Почему важно: такой сюжет обычно запускает расширенную проверку и запрос первичных документов.\n\n" +
      "Что проверить: сверить списки; запросить корпоративные документы; уточнить идентификацию.";
    // Force over the generic bullet budget (marker adds more).
    const padded = `${fullText}\n\n${"Дополнительный контекст проверки. ".repeat(40)}`;
    expect(padded.length).toBeGreaterThan(900);

    const plan: CrossSlideDisclosurePlan = {
      schemaVersion: CROSS_SLIDE_DISCLOSURE_PLAN_VERSION,
      caseId: "c",
      datasetId: "d",
      generatedAt: new Date().toISOString(),
      materials: [
        {
          findingId: f.findingId,
          themeId: "sanctions",
          themeLabel: f.theme,
          evidenceRefs: f.evidenceRefs,
          fullOwnerFragment: "UAE_SUMMARY",
          fullText: padded,
          briefText: "Кратко.",
          matrixText: "Матрица.",
          surfaceAngles: { serp: "s", images: "i", suggestions: "g" },
        },
      ],
      gates: {
        MATERIALS_WITHOUT_FULL_DISCLOSURE: 0,
        MATERIALS_WITH_MULTIPLE_FULL_OWNERS: 0,
        CROSS_SLIDE_DUPLICATE_SENTENCES: 0,
      },
    };

    const sc = scoped([f]);
    const out = buildRegionalSummaryFragment(
      "UAE_SUMMARY",
      "UAE_PROFILE",
      "ОАЭ / международный",
      sc,
      { crossSlideDisclosurePlan: plan }
    );
    const longBullet = out.slides
      .flatMap((s) => s.content.bullets ?? [])
      .find((b) => b.includes(f.findingId));
    expect(longBullet).toBeTruthy();
    expect(longBullet!.length).toBeGreaterThan(900);

    const pack = asPack("UAE_SUMMARY", out, sc);
    const report = validateSectionPack({
      pack,
      expectedCaseId: "c",
      expectedReportRunId: "r1",
      expectedDatasetId: "d",
      bundle: { findings: [f] } as never,
      knownEvidenceRefs: new Set(["inventory:1"]),
      evidenceIndex: sc.evidenceIndex,
    });
    expect(report.passed, report.issues.join("; ")).toBe(true);
  });
});
