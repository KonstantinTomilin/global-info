/**
 * C5 — ClientSummaryComposer: ORION-density theme prose from CanonicalClaims.
 * Theme taxonomy is for grouping only — CLIENT_THEME_WHY/FRAMING are not terminal copy.
 */

import { getFindingThemes } from "../../config/finding-themes";
import type { CanonicalClaim, CanonicalClaimBundle } from "../contracts/canonical-claim";
import {
  COMPOSED_CLIENT_SUMMARY_VERSION,
  type ComposedClientSummary,
  type ComposedThemeArticle,
  type ComposedThemeBlock,
} from "../contracts/composed-client-summary";
import {
  ADVERSE_THEME_IDS,
  resolveThemeRef,
} from "./canonical-claim-builder";
import { hasDanglingTail, isIncompleteClientQuote } from "./finding-synthesizer";
import { matchInternalClientToken } from "../client/load-client-text-contract";
import { scanOrionGoldenClientTextForForbiddenTokens } from "../client/client-text-sanitizer";

/** Database / watchlist themes — kept as a separate client block from media. */
export const DATABASE_THEME_IDS = new Set(["pep_rca_watchlist"]);

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "источник";
  }
}

function themeLabelFor(themeId: string): string {
  return getFindingThemes().find((t) => t.themeId === themeId)?.label ?? themeId;
}

function isDatabaseTheme(themeId: string, themeLabel: string): boolean {
  return (
    DATABASE_THEME_IDS.has(themeId) ||
    /санкц|PEP|watchlist|Dow Jones|Lexis/i.test(themeLabel)
  );
}

function countTechnicalTokens(text: string): number {
  let n = 0;
  if (matchInternalClientToken(text)) n += 1;
  n += scanOrionGoldenClientTextForForbiddenTokens(text).length;
  if (/\bfinding-[a-z0-9-]+\b/i.test(text)) n += 1;
  if (/\binventory:[a-z0-9-]+\b/i.test(text)) n += 1;
  if (/\b(P1|P2|P3|APPENDIX|SUBJECT_MATCH)\b/.test(text)) n += 1;
  return n;
}

function countIncompleteSentences(text: string): number {
  const parts = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let n = 0;
  for (const p of parts) {
    if (hasDanglingTail(p) || isIncompleteClientQuote(p) || /[,;:]$/u.test(p)) n += 1;
  }
  return n;
}

function buildArticle(claim: CanonicalClaim): ComposedThemeArticle {
  const domain = domainOf(claim.url);
  const attribution =
    claim.attribution?.trim() ||
    (claim.claimKind === "SOURCE_ALLEGATION" ? "сообщается" : null);
  const lead = attribution
    ? `В материале ${domain} ${attribution.includes("сообщ") ? "сообщается" : "утверждается"}:`
    : `В материале ${domain}:`;
  const body = [
    `${lead} ${claim.clientDescription.trim()}`,
    `Источник: ${domain}. ${claim.qualification.trim()}`,
  ].join("\n\n");

  return {
    evidenceRef: claim.evidenceRefs[0]!,
    domain,
    body,
    whyItMatters: claim.whyItMatters.trim(),
    qualification: claim.qualification.trim(),
    recommendedChecks: claim.recommendedChecks,
    claimId: claim.claimId,
  };
}

function synthesizeThemeWhy(articles: ComposedThemeArticle[]): string {
  const uniq: string[] = [];
  for (const a of articles) {
    const w = a.whyItMatters.trim();
    if (!w) continue;
    if (uniq.some((u) => u === w)) continue;
    uniq.push(w);
    if (uniq.length >= 2) break;
  }
  return uniq.join(" ");
}

function buildConclusion(
  themeLabel: string,
  articles: ComposedThemeArticle[],
  isDb: boolean
): string {
  const domains = [...new Set(articles.map((a) => a.domain))].slice(0, 3).join(", ");
  if (isDb) {
    return `По международным базам и мониторинговым спискам зафиксированы сигналы по теме «${themeLabel}» (источники: ${domains}).`;
  }
  return `По открытым СМИ по теме «${themeLabel}» выявлены существенные публикации (${domains}), требующие проверки первичных документов.`;
}

function composeThemeBlock(input: {
  themeId: string;
  themeLabel: string;
  claims: CanonicalClaim[];
  isDatabase: boolean;
}): ComposedThemeBlock {
  const ranked = [...input.claims].sort((a, b) => {
    const ra = a.contentSource === "full_text" ? 0 : 1;
    const rb = b.contentSource === "full_text" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.claimId.localeCompare(b.claimId);
  });
  const articles = ranked.slice(0, 2).map(buildArticle);
  const checks = [...new Set(articles.flatMap((a) => a.recommendedChecks))].slice(0, 4);
  const why = synthesizeThemeWhy(articles);

  return {
    themeId: input.themeId,
    themeLabel: input.themeLabel,
    isAdverse: input.claims.some((c) => c.isAdverseTheme),
    isDatabaseBlock: input.isDatabase,
    conclusion: buildConclusion(input.themeLabel, articles, input.isDatabase),
    articles,
    whyItMatters: why,
    recommendedChecks:
      checks.length > 0 ? checks : ["Проверить первоисточники по теме"],
    evidenceRefs: [...new Set(articles.map((a) => a.evidenceRef))],
  };
}

/**
 * Compose client summary from grounded CanonicalClaims.
 * @param excludeEvidenceRefs — C4 APPENDIX_OTHER junk excluded from media examples.
 */
export function composeClientSummary(input: {
  caseId: string;
  datasetId: string;
  claims: CanonicalClaimBundle;
  /** Theme ids considered material for coverage (defaults to adverse/high claims present). */
  materialThemeKeys?: string[];
  /** Evidence refs dispositioned as APPENDIX_OTHER (junk) — skip for media theme blocks. */
  excludeEvidenceRefs?: Iterable<string>;
}): ComposedClientSummary {
  const excluded = new Set(input.excludeEvidenceRefs ?? []);
  const byTheme = new Map<string, CanonicalClaim[]>();
  for (const claim of input.claims.claims) {
    const primaryRef = claim.evidenceRefs[0] ?? "";
    if (excluded.has(primaryRef) && !DATABASE_THEME_IDS.has(claim.theme)) {
      continue;
    }
    const themeId = resolveThemeRef(claim.theme).themeId;
    const list = byTheme.get(themeId) ?? [];
    list.push({ ...claim, theme: themeId });
    byTheme.set(themeId, list);
  }

  const mediaBlocks: ComposedThemeBlock[] = [];
  const databaseBlocks: ComposedThemeBlock[] = [];

  for (const [themeId, claims] of byTheme) {
    const label = themeLabelFor(themeId);
    const isDb = isDatabaseTheme(themeId, label);
    const block = composeThemeBlock({
      themeId,
      themeLabel: label,
      claims,
      isDatabase: isDb,
    });
    if (isDb) databaseBlocks.push(block);
    else mediaBlocks.push(block);
  }

  const allBlocks = [...mediaBlocks, ...databaseBlocks];
  const materialKeys =
    input.materialThemeKeys ??
    [
      ...new Set(
        input.claims.claims
          .filter(
            (c) =>
              c.isAdverseTheme ||
              c.riskLevel === "high" ||
              c.riskLevel === "critical" ||
              ADVERSE_THEME_IDS.has(resolveThemeRef(c.theme).themeId)
          )
          .map((c) => resolveThemeRef(c.theme).themeId)
          .filter((themeId) => {
            // Material coverage only for themes that still have usable claims
            // after C4 exclusion (database themes keep appendix-eligible rows).
            if (DATABASE_THEME_IDS.has(themeId)) return byTheme.has(themeId);
            return byTheme.has(themeId);
          })
      ),
    ];
  const covered = new Set(allBlocks.map((b) => b.themeId));
  const coveredMaterial = materialKeys.filter((k) => covered.has(k)).length;
  const coverage =
    materialKeys.length === 0 ? 1 : coveredMaterial / materialKeys.length;

  const whyByTheme = allBlocks.map((b) => b.whyItMatters);
  const articleWhys = allBlocks.flatMap((b) => b.articles.map((a) => a.whyItMatters));
  const perThemeWhyArticleSpecific =
    articleWhys.length === 0 ||
    allBlocks.every((b) =>
      b.articles.every((a) => b.whyItMatters.includes(a.whyItMatters.slice(0, 40)))
    );

  // Identical long why on different articles/themes ⇒ theme-constant collapse.
  let constantWhyCollapse = false;
  for (let i = 0; i < whyByTheme.length; i++) {
    for (let j = i + 1; j < whyByTheme.length; j++) {
      if (
        whyByTheme[i] === whyByTheme[j] &&
        (whyByTheme[i]?.length ?? 0) > 40 &&
        allBlocks[i]!.articles[0]?.claimId !== allBlocks[j]!.articles[0]?.claimId
      ) {
        constantWhyCollapse = true;
      }
    }
  }
  const articleWhyPairs = allBlocks.flatMap((b) =>
    b.articles.map((a) => ({ claimId: a.claimId, why: a.whyItMatters.trim() }))
  );
  for (let i = 0; i < articleWhyPairs.length; i++) {
    for (let j = i + 1; j < articleWhyPairs.length; j++) {
      const a = articleWhyPairs[i]!;
      const b = articleWhyPairs[j]!;
      if (
        a.claimId !== b.claimId &&
        a.why === b.why &&
        a.why.length > 40
      ) {
        constantWhyCollapse = true;
      }
    }
  }

  let tech = 0;
  let incomplete = 0;
  let unsupported = 0;
  for (const b of allBlocks) {
    const texts = [
      b.conclusion,
      b.whyItMatters,
      ...b.articles.map((a) => a.body),
      ...b.recommendedChecks,
    ];
    for (const t of texts) {
      tech += countTechnicalTokens(t);
      incomplete += countIncompleteSentences(t);
    }
    for (const a of b.articles) {
      if (!a.qualification.trim() || !a.body.trim()) unsupported += 1;
    }
  }

  const materialBlocks = allBlocks.filter((b) => materialKeys.includes(b.themeId));
  const concreteExamples =
    materialKeys.length === 0
      ? true
      : materialBlocks.length > 0 &&
        materialBlocks.every((b) => b.articles.length > 0);

  return {
    schemaVersion: COMPOSED_CLIENT_SUMMARY_VERSION,
    caseId: input.caseId,
    datasetId: input.datasetId,
    generatedAt: new Date().toISOString(),
    mediaThemeBlocks: mediaBlocks,
    databaseThemeBlocks: databaseBlocks,
    gates: {
      SUMMARY_MATERIAL_THEME_COVERAGE: coverage,
      SUMMARY_CONCRETE_EXAMPLES_PRESENT: concreteExamples,
      PER_THEME_WHY_IS_ARTICLE_SPECIFIC:
        perThemeWhyArticleSpecific && !constantWhyCollapse,
      SUMMARY_UNSUPPORTED_ASSERTIONS: unsupported,
      SUMMARY_TECHNICAL_COPY_TOKENS: tech,
      SUMMARY_INCOMPLETE_SENTENCES: incomplete,
      materialThemeCount: materialKeys.length,
      coveredMaterialThemeCount: coveredMaterial,
    },
  };
}

/** Flatten a theme block into client-facing finding.claim replacement text. */
export function themeBlockToClaimText(block: ComposedThemeBlock): string {
  const parts = [
    block.conclusion,
    ...block.articles.map((a) => a.body),
    `Почему важно: ${block.whyItMatters}`,
    `Что проверить: ${block.recommendedChecks.join("; ")}`,
  ];
  return parts.join("\n\n");
}

/** C5 stop-gate — throw when composed summary fails editorial gates. */
export function assertComposedSummaryGatesPass(summary: ComposedClientSummary): void {
  const g = summary.gates;
  if (g.SUMMARY_MATERIAL_THEME_COVERAGE < 1) {
    throw new Error(
      `SUMMARY_MATERIAL_THEME_COVERAGE=${g.SUMMARY_MATERIAL_THEME_COVERAGE} ` +
        `(${g.coveredMaterialThemeCount}/${g.materialThemeCount})`
    );
  }
  if (!g.SUMMARY_CONCRETE_EXAMPLES_PRESENT) {
    throw new Error("SUMMARY_CONCRETE_EXAMPLES_PRESENT=false");
  }
  if (!g.PER_THEME_WHY_IS_ARTICLE_SPECIFIC) {
    throw new Error("PER_THEME_WHY_IS_ARTICLE_SPECIFIC=false");
  }
  if (g.SUMMARY_UNSUPPORTED_ASSERTIONS !== 0) {
    throw new Error(
      `SUMMARY_UNSUPPORTED_ASSERTIONS=${g.SUMMARY_UNSUPPORTED_ASSERTIONS}`
    );
  }
  if (g.SUMMARY_TECHNICAL_COPY_TOKENS !== 0) {
    throw new Error(
      `SUMMARY_TECHNICAL_COPY_TOKENS=${g.SUMMARY_TECHNICAL_COPY_TOKENS}`
    );
  }
  if (g.SUMMARY_INCOMPLETE_SENTENCES !== 0) {
    throw new Error(
      `SUMMARY_INCOMPLETE_SENTENCES=${g.SUMMARY_INCOMPLETE_SENTENCES}`
    );
  }
}

/**
 * Replace Finding.claim template text with composed theme prose where themes match.
 * Finding.theme may be label or themeId.
 */
export function applyComposedClaimsToFindings<
  T extends { theme: string; claim: string },
>(findings: T[], summary: ComposedClientSummary): T[] {
  const byThemeId = new Map<string, ComposedThemeBlock>();
  for (const b of [...summary.mediaThemeBlocks, ...summary.databaseThemeBlocks]) {
    byThemeId.set(b.themeId, b);
  }
  return findings.map((f) => {
    const themeId = resolveThemeRef(f.theme).themeId;
    const block = byThemeId.get(themeId);
    if (!block) return f;
    return { ...f, claim: themeBlockToClaimText(block) };
  });
}
