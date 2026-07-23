/**
 * C8 — Content-quality evaluation harness over SectionPacks + composed summary
 * + grounded claims / item analysis (deterministic gates; NETWORK_CALLS=0).
 */

import type { ComposedClientSummary, ComposedThemeArticle } from "../contracts/composed-client-summary";
import type { CanonicalClaim, CanonicalClaimBundle } from "../contracts/canonical-claim";
import type { Finding } from "../contracts/finding";
import type { ItemAnalysisBundle } from "../contracts/item-analysis";
import {
  CONTENT_QUALITY_REPORT_VERSION,
  type ContentQualityReport,
  assertContentQualityGatesPass,
} from "../contracts/content-quality-report";
import { resolveThemeRef } from "../analytics/canonical-claim-builder";
import { countIncompleteSentences } from "../analytics/incomplete-client-sentences";
import { matchInternalClientToken } from "../client/load-client-text-contract";
import { scanOrionGoldenClientTextForForbiddenTokens } from "../client/client-text-sanitizer";
import {
  splitSentences,
  validateItemAnalysisGrounding,
} from "../grounded-item-analyst/grounding-guards";
import type { FragmentKey, SectionPackV2 } from "./contracts";
import { countClientTextTruncations } from "./semantic-summary-pagination";

const THEME_FRAGMENTS = new Set<FragmentKey>([
  "EXECUTIVE_SUMMARY",
  "RISK_MATRIX",
  "RU_SUMMARY",
  "UAE_SUMMARY",
]);

const EXCLUDED_FRAGMENTS = new Set<FragmentKey>(["FRONT_MATTER_MAIN", "APPENDIX_MAIN"]);

const RISK_ORDER: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export type ContentQualityEvalInput = {
  caseId: string;
  datasetId?: string;
  packs: SectionPackV2[];
  findings?: Finding[];
  composedClientSummary?: ComposedClientSummary | null;
  canonicalClaims?: CanonicalClaimBundle | null;
  itemAnalysis?: ItemAnalysisBundle | null;
  /** evidenceRef → source text for span validation (from source-content-index). */
  sourceTextByEvidenceRef?: Record<string, string>;
  /** C4 APPENDIX_OTHER refs that must not appear as adverse examples. */
  excludeEvidenceRefs?: Iterable<string>;
  allowedProfileTokens?: string[];
};

function collectPackClientTexts(packs: SectionPackV2[]): string[] {
  const out: string[] = [];
  for (const pack of packs) {
    if (EXCLUDED_FRAGMENTS.has(pack.fragmentKey)) continue;
    for (const slide of pack.slides) {
      const c = slide.content;
      if (c.narrative) out.push(c.narrative);
      if (c.bullets) out.push(...c.bullets);
      if (c.whatWasFound) out.push(c.whatWasFound);
      if (c.whyItMatters) out.push(c.whyItMatters);
      if (c.whatToCheck) out.push(c.whatToCheck);
      if (c.statusNote) out.push(c.statusNote);
    }
  }
  return out;
}

function collectThemePackTexts(packs: SectionPackV2[]): string[] {
  return packs
    .filter((p) => THEME_FRAGMENTS.has(p.fragmentKey))
    .flatMap((p) =>
      p.slides.flatMap((s) => [
        s.content.narrative ?? "",
        ...(s.content.bullets ?? []),
        s.content.whatWasFound ?? "",
        s.content.whyItMatters ?? "",
      ])
    )
    .filter(Boolean);
}

/**
 * Strip QA-only markers and URL domains before technical scans.
 * Live Deripaska: CLIENT_TECHNICAL_TOKENS=36 was almost entirely trailing
 * `[finding-…]` markers on regional theme bullets (not client-facing prose).
 */
function stripQaMarkersForTechScan(text: string): string {
  return text
    .replace(/\s*\[finding-[^\]]+\]\s*/giu, " ")
    // Domains are legitimate client copy (audit-it.ru must not trip \baudit\b).
    .replace(/\b[\w-]+(?:\.[\w-]+)+\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function countTechnicalTokens(text: string): number {
  const t = stripQaMarkersForTechScan(text);
  if (!t) return 0;
  let n = 0;
  if (matchInternalClientToken(t)) n += 1;
  n += scanOrionGoldenClientTextForForbiddenTokens(t).length;
  // Bare finding-/inventory- in prose (not the stripped `[finding-…]` markers).
  if (/\bfinding-[a-z0-9-]+\b/i.test(t)) n += 1;
  if (/\binventory:[a-z0-9-]+\b/i.test(t)) n += 1;
  if (/\b(P1|P2|P3|APPENDIX|SUBJECT_MATCH)\b/.test(t)) n += 1;
  return n;
}

function criticalHighThemeIds(findings: Finding[]): string[] {
  const ids = new Set<string>();
  for (const f of findings) {
    if (f.subjectMatch !== "SUBJECT_MATCH") continue;
    if ((RISK_ORDER[f.riskLevel] ?? 0) < RISK_ORDER.high) continue;
    ids.add(resolveThemeRef(f.theme).themeId);
  }
  return [...ids];
}

function validateExampleStructure(article: ComposedThemeArticle): string[] {
  const issues: string[] = [];
  const body = article.body.trim();
  if (body.length < 40) issues.push(`${article.evidenceRef}: retelling_too_short`);
  if (!/В материале/i.test(body)) issues.push(`${article.evidenceRef}: missing_retelling_lead`);
  if (!/Источник:/i.test(body)) issues.push(`${article.evidenceRef}: missing_source`);
  if (!article.qualification?.trim()) issues.push(`${article.evidenceRef}: missing_qualification`);
  if (article.recommendedChecks.length === 0) {
    issues.push(`${article.evidenceRef}: missing_checks`);
  }
  if (!/сообща|утвержд|указыва|изложен|описыва/i.test(body)) {
    issues.push(`${article.evidenceRef}: missing_attribution`);
  }
  return issues;
}

function sourceTextForClaim(
  claim: CanonicalClaim,
  sourceTextByEvidenceRef: Record<string, string>,
  itemAnalysis?: ItemAnalysisBundle | null
): string {
  const ref = claim.evidenceRefs[0] ?? "";
  const fromIndex = sourceTextByEvidenceRef[ref];
  if (fromIndex?.trim()) return fromIndex;
  const analysis = itemAnalysis?.analyses.find((a) => a.evidenceRef === ref);
  if (analysis) {
    const spanQuotes = analysis.supportingSpans.map((s) => s.quote).join(" ");
    if (spanQuotes.trim()) return spanQuotes;
  }
  return claim.supportingSpans.map((s) => s.quote).join(" ");
}

function countJunkAdverseExamples(input: {
  summary: ComposedClientSummary | null | undefined;
  excludeRefs: Set<string>;
}): { count: number; refs: string[] } {
  if (!input.summary) return { count: 0, refs: [] };
  const refs: string[] = [];
  for (const block of [...input.summary.mediaThemeBlocks, ...input.summary.databaseThemeBlocks]) {
    for (const art of block.articles) {
      if (input.excludeRefs.has(art.evidenceRef)) {
        refs.push(art.evidenceRef);
      }
    }
  }
  return { count: refs.length, refs: [...new Set(refs)] };
}

function groundingViolations(input: {
  claims: CanonicalClaim[];
  sourceTextByEvidenceRef: Record<string, string>;
  itemAnalysis?: ItemAnalysisBundle | null;
  allowedProfileTokens: string[];
}): { count: number; samples: string[] } {
  const samples: string[] = [];
  let count = 0;
  for (const claim of input.claims) {
    const sourceText = sourceTextForClaim(
      claim,
      input.sourceTextByEvidenceRef,
      input.itemAnalysis
    );
    if (!sourceText.trim()) {
      count += splitSentences(claim.clientDescription).length;
      samples.push(`${claim.claimId}: empty_source_text`);
      continue;
    }
    const result = validateItemAnalysisGrounding({
      clientDescription: claim.clientDescription,
      claimKind: claim.claimKind,
      attribution: claim.attribution,
      supportingSpans: claim.supportingSpans,
      sourceText,
      allowedProfileTokens: input.allowedProfileTokens,
      contentSource: claim.contentSource,
    });
    const sentenceCount = splitSentences(claim.clientDescription).length;
    const ungrounded = Math.max(
      0,
      sentenceCount - Math.round(result.groundedSentenceRatio * sentenceCount)
    );
    count += ungrounded;
    if (ungrounded > 0) {
      for (const issue of result.issues) {
        if (issue.code === "MISSING_SPAN" || issue.code === "SPAN_NOT_IN_SOURCE") {
          if (samples.length < 12) {
            samples.push(`${claim.claimId}: ${issue.detail}`);
          }
        }
      }
      if (samples.length < 12 && ungrounded > 0 && result.issues.length === 0) {
        samples.push(`${claim.claimId}: groundedSentenceRatio=${result.groundedSentenceRatio}`);
      }
    }
  }
  return { count, samples };
}

function claimsInClientOutput(input: {
  summary: ComposedClientSummary | null | undefined;
  canonicalClaims: CanonicalClaimBundle | null | undefined;
}): CanonicalClaim[] {
  if (!input.summary || !input.canonicalClaims) return [];
  const claimIds = new Set(
    [...input.summary.mediaThemeBlocks, ...input.summary.databaseThemeBlocks].flatMap((b) =>
      b.articles.map((a) => a.claimId)
    )
  );
  const evidenceRefs = new Set(
    [...input.summary.mediaThemeBlocks, ...input.summary.databaseThemeBlocks].flatMap((b) =>
      b.articles.map((a) => a.evidenceRef)
    )
  );
  return input.canonicalClaims.claims.filter(
    (c) => claimIds.has(c.claimId) || evidenceRefs.has(c.evidenceRefs[0] ?? "")
  );
}

/**
 * Evaluate deterministic content-quality gates for deck client copy.
 */
export function evaluateContentQuality(input: ContentQualityEvalInput): ContentQualityReport {
  const excludeRefs = new Set(input.excludeEvidenceRefs ?? []);
  const sourceTextByEvidenceRef = input.sourceTextByEvidenceRef ?? {};
  const allowedProfileTokens = input.allowedProfileTokens ?? [];
  const findings = input.findings ?? [];
  const packTexts = collectPackClientTexts(input.packs);
  const themeTexts = collectThemePackTexts(input.packs);
  const composedTexts = input.composedClientSummary
    ? [
        ...input.composedClientSummary.mediaThemeBlocks.flatMap((b) => [
          b.conclusion,
          b.whyItMatters,
          ...b.articles.map((a) => a.body),
          ...b.recommendedChecks,
        ]),
        ...input.composedClientSummary.databaseThemeBlocks.flatMap((b) => [
          b.conclusion,
          b.whyItMatters,
          ...b.articles.map((a) => a.body),
          ...b.recommendedChecks,
        ]),
      ]
    : [];
  const allClientTexts = [...packTexts, ...composedTexts];

  let tech = 0;
  let incomplete = 0;
  for (const t of allClientTexts) {
    tech += countTechnicalTokens(t);
    // Strip QA-only `[finding-…]` before incomplete scan (markers are not prose).
    incomplete += countIncompleteSentences(stripQaMarkersForTechScan(t));
  }

  const trunc = countClientTextTruncations(themeTexts);

  const criticalHighThemes = criticalHighThemeIds(findings);
  const composedThemeIds = new Set(
    input.composedClientSummary
      ? [
          ...input.composedClientSummary.mediaThemeBlocks,
          ...input.composedClientSummary.databaseThemeBlocks,
        ]
          .filter((b) => b.articles.length > 0)
          .map((b) => b.themeId)
      : []
  );
  const coveredCriticalHigh = criticalHighThemes.filter((t) => composedThemeIds.has(t)).length;
  const themeCoverage =
    criticalHighThemes.length === 0
      ? 1
      : coveredCriticalHigh / criticalHighThemes.length;

  const structureViolations: string[] = [];
  if (input.composedClientSummary) {
    for (const block of [
      ...input.composedClientSummary.mediaThemeBlocks,
      ...input.composedClientSummary.databaseThemeBlocks,
    ]) {
      for (const art of block.articles) {
        structureViolations.push(...validateExampleStructure(art));
      }
    }
  }

  const junk = countJunkAdverseExamples({
    summary: input.composedClientSummary,
    excludeRefs,
  });

  const outputClaims = claimsInClientOutput({
    summary: input.composedClientSummary,
    canonicalClaims: input.canonicalClaims,
  });
  const grounding = groundingViolations({
    claims: outputClaims,
    sourceTextByEvidenceRef,
    itemAnalysis: input.itemAnalysis,
    allowedProfileTokens,
  });

  const perThemeWhy = input.composedClientSummary?.gates.PER_THEME_WHY_IS_ARTICLE_SPECIFIC;

  const gates = {
    CRITICAL_HIGH_THEME_COVERAGE: themeCoverage,
    criticalHighThemeCount: criticalHighThemes.length,
    coveredCriticalHighThemeCount: coveredCriticalHigh,
    CONCRETE_EXAMPLE_STRUCTURE_VIOLATIONS: structureViolations.length,
    CLIENT_TECHNICAL_TOKENS: tech,
    CLIENT_INCOMPLETE_SENTENCES: incomplete,
    CLIENT_TEXT_TRUNCATIONS: trunc.count,
    JUNK_ADVERSE_EXAMPLES: junk.count,
    UNGROUNDED_CLIENT_SENTENCES: grounding.count,
    PER_THEME_WHY_IS_ARTICLE_SPECIFIC: perThemeWhy,
  };

  const report: ContentQualityReport = {
    schemaVersion: CONTENT_QUALITY_REPORT_VERSION,
    caseId: input.caseId,
    datasetId: input.datasetId,
    generatedAt: new Date().toISOString(),
    CEO_READY: false,
    inputs: {
      sectionPackCount: input.packs.length,
      composedSummaryPresent: Boolean(input.composedClientSummary),
      canonicalClaimsPresent: Boolean(input.canonicalClaims),
      itemAnalysisPresent: Boolean(input.itemAnalysis),
    },
    gates,
    samples: {
      structureViolations: structureViolations.slice(0, 12),
      ungroundedSentences: grounding.samples.slice(0, 12),
      truncations: trunc.samples.slice(0, 8),
      junkEvidenceRefs: junk.refs.slice(0, 8),
    },
    deterministicPass: false,
  };

  report.deterministicPass = isDeterministicPass(report);
  return report;
}

function isDeterministicPass(report: ContentQualityReport): boolean {
  try {
    assertContentQualityGatesPass(report);
    return true;
  } catch {
    return false;
  }
}

export { assertContentQualityGatesPass };
