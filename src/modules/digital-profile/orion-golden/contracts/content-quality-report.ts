/**
 * C8 — Content-quality evaluation report (deterministic editorial gates).
 */

import { z } from "zod";

export const CONTENT_QUALITY_REPORT_VERSION = "content-quality-report-v1" as const;

export const ContentQualityReportSchema = z.object({
  schemaVersion: z.literal(CONTENT_QUALITY_REPORT_VERSION),
  caseId: z.string().min(1),
  datasetId: z.string().min(1).optional(),
  generatedAt: z.string().min(1),
  /** Stays false until C8 golden set + manual visual acceptance (plan §C8/C9). */
  CEO_READY: z.literal(false),
  inputs: z.object({
    sectionPackCount: z.number().int().nonnegative(),
    composedSummaryPresent: z.boolean(),
    canonicalClaimsPresent: z.boolean(),
    itemAnalysisPresent: z.boolean(),
  }),
  gates: z.object({
    /** Ratio of CRITICAL/HIGH subject-matched themes with concrete composed examples. */
    CRITICAL_HIGH_THEME_COVERAGE: z.number().min(0).max(1),
    criticalHighThemeCount: z.number().int().nonnegative(),
    coveredCriticalHighThemeCount: z.number().int().nonnegative(),
    /** Examples missing retelling + source + attribution + qualification + checks. */
    CONCRETE_EXAMPLE_STRUCTURE_VIOLATIONS: z.number().int().nonnegative(),
    CLIENT_TECHNICAL_TOKENS: z.number().int().nonnegative(),
    CLIENT_INCOMPLETE_SENTENCES: z.number().int().nonnegative(),
    /** Mid-clip / dangling tails in theme-bearing SectionPack client text (C7 overlap). */
    CLIENT_TEXT_TRUNCATIONS: z.number().int().nonnegative(),
    /** Junk / appendix-disposition refs surfaced as adverse examples. */
    JUNK_ADVERSE_EXAMPLES: z.number().int().nonnegative(),
    /** Client sentences without valid supportingSpans in source text. */
    UNGROUNDED_CLIENT_SENTENCES: z.number().int().nonnegative(),
    PER_THEME_WHY_IS_ARTICLE_SPECIFIC: z.boolean().optional(),
  }),
  samples: z.object({
    structureViolations: z.array(z.string()).max(12),
    ungroundedSentences: z.array(z.string()).max(12),
    truncations: z.array(z.string()).max(8),
    junkEvidenceRefs: z.array(z.string()).max(8),
  }),
  deterministicPass: z.boolean(),
});

export type ContentQualityReport = z.infer<typeof ContentQualityReportSchema>;

/** Fail-closed C8 stop-gate (deterministic checks only; LLM-judge optional later). */
export function assertContentQualityGatesPass(report: ContentQualityReport): void {
  const g = report.gates;
  if (g.criticalHighThemeCount > 0 && g.CRITICAL_HIGH_THEME_COVERAGE < 1) {
    throw new Error(
      `CRITICAL_HIGH_THEME_COVERAGE=${g.CRITICAL_HIGH_THEME_COVERAGE} ` +
        `(${g.coveredCriticalHighThemeCount}/${g.criticalHighThemeCount})`
    );
  }
  if (g.CONCRETE_EXAMPLE_STRUCTURE_VIOLATIONS !== 0) {
    throw new Error(
      `CONCRETE_EXAMPLE_STRUCTURE_VIOLATIONS=${g.CONCRETE_EXAMPLE_STRUCTURE_VIOLATIONS}; ` +
        `${report.samples.structureViolations.slice(0, 3).join(" | ")}`
    );
  }
  if (g.CLIENT_TECHNICAL_TOKENS !== 0) {
    throw new Error(`CLIENT_TECHNICAL_TOKENS=${g.CLIENT_TECHNICAL_TOKENS}`);
  }
  if (g.CLIENT_INCOMPLETE_SENTENCES !== 0) {
    throw new Error(`CLIENT_INCOMPLETE_SENTENCES=${g.CLIENT_INCOMPLETE_SENTENCES}`);
  }
  if (g.CLIENT_TEXT_TRUNCATIONS !== 0) {
    throw new Error(
      `CLIENT_TEXT_TRUNCATIONS=${g.CLIENT_TEXT_TRUNCATIONS}; ${report.samples.truncations.join(" | ")}`
    );
  }
  if (g.JUNK_ADVERSE_EXAMPLES !== 0) {
    throw new Error(
      `JUNK_ADVERSE_EXAMPLES=${g.JUNK_ADVERSE_EXAMPLES}; ${report.samples.junkEvidenceRefs.join(",")}`
    );
  }
  if (g.UNGROUNDED_CLIENT_SENTENCES !== 0) {
    throw new Error(
      `UNGROUNDED_CLIENT_SENTENCES=${g.UNGROUNDED_CLIENT_SENTENCES}; ` +
        `${report.samples.ungroundedSentences.slice(0, 3).join(" | ")}`
    );
  }
  if (g.PER_THEME_WHY_IS_ARTICLE_SPECIFIC === false) {
    throw new Error("PER_THEME_WHY_IS_ARTICLE_SPECIFIC=false");
  }
}
