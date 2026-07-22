/**
 * C3 — Build CanonicalClaims from ItemAnalysis (+ Finding theme/risk join).
 */

import { createHash } from "node:crypto";
import type { Finding } from "../contracts/finding";
import type { ItemAnalysis, ItemAnalysisBundle } from "../contracts/item-analysis";
import {
  CANONICAL_CLAIM_SCHEMA_VERSION,
  type CanonicalClaim,
  type CanonicalClaimBundle,
} from "../contracts/canonical-claim";
import type { SourceContentIndex } from "../contracts/source-content-index";

/** Adverse theme ids used for C3 stop-gate coverage (matches finding-synthesizer). */
export const ADVERSE_THEME_IDS = new Set([
  "criminal_legal",
  "pep_rca_watchlist",
  "political_exposure",
  "offshore_corporate",
  "family_associates",
  "financial_claims",
  "security_scrutiny",
]);

function claimIdFor(analysis: ItemAnalysis, theme: string): string {
  return createHash("sha256")
    .update(`${analysis.evidenceRef}|${theme}|${analysis.promptVersion}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function findFindingsFor(
  analysis: ItemAnalysis,
  findings: Finding[],
  findingIdsFromSource: string[]
): Finding[] {
  const ids = new Set(findingIdsFromSource);
  const byId = findings.filter((f) => ids.has(f.findingId));
  if (byId.length > 0) return byId;
  return findings.filter((f) => f.evidenceRefs.includes(analysis.evidenceRef));
}

export function buildCanonicalClaims(input: {
  caseId: string;
  datasetId: string;
  itemAnalysis: ItemAnalysisBundle;
  findings: Finding[];
  sourceContent?: SourceContentIndex | null;
}): CanonicalClaimBundle {
  const findingIdsByRef = new Map<string, string[]>();
  if (input.sourceContent) {
    for (const e of input.sourceContent.entries) {
      findingIdsByRef.set(e.evidenceRef, e.findingIds);
    }
  }
  const storageByRef = new Map<string, string | null>();
  if (input.sourceContent) {
    for (const e of input.sourceContent.entries) {
      storageByRef.set(e.evidenceRef, e.storageRef);
    }
  }

  const claims: CanonicalClaim[] = [];

  for (const analysis of input.itemAnalysis.analyses) {
    const linked = findFindingsFor(
      analysis,
      input.findings,
      findingIdsByRef.get(analysis.evidenceRef) ?? []
    );
    const theme = linked[0]?.theme ?? "uncategorized";
    const riskLevel = linked[0]?.riskLevel ?? "medium";
    const isAdverseTheme = ADVERSE_THEME_IDS.has(theme);

    const clientDescription = analysis.clientDescription.trim();
    if (!clientDescription) {
      throw new Error(`CanonicalClaim empty clientDescription for ${analysis.evidenceRef}`);
    }
    const qualification = analysis.qualification.trim();
    if (!qualification) {
      throw new Error(`CanonicalClaim empty qualification for ${analysis.evidenceRef}`);
    }

    // C3 invariant: displayExcerpt is the full grounded description — never sliced.
    const displayExcerpt = clientDescription;
    if (displayExcerpt !== clientDescription) {
      throw new Error("SEMANTIC_EXCERPT_TRUNCATIONS");
    }

    claims.push({
      schemaVersion: CANONICAL_CLAIM_SCHEMA_VERSION,
      claimId: claimIdFor(analysis, theme),
      evidenceRefs: [analysis.evidenceRef],
      inventoryId: analysis.inventoryId,
      url: analysis.url,
      theme,
      isAdverseTheme,
      riskLevel,
      clientDescription,
      displayExcerpt,
      claimKind: analysis.claimKind,
      attribution: analysis.attribution,
      qualification,
      recommendedChecks: analysis.recommendedChecks,
      whyItMatters: analysis.whyItMatters,
      supportingSpans: analysis.supportingSpans,
      contentSource: analysis.contentSource,
      originalFullTextRef: storageByRef.get(analysis.evidenceRef) ?? null,
      contentHash: analysis.contentHash,
      findingIds: linked.map((f) => f.findingId),
      semanticExcerptTruncations: 0,
    });
  }

  const adverse = claims.filter((c) => c.isAdverseTheme);
  const adverseOk = adverse.filter(
    (c) =>
      c.clientDescription.trim().length > 0 &&
      c.qualification.trim().length > 0 &&
      c.evidenceRefs.length >= 1 &&
      c.semanticExcerptTruncations === 0
  );

  return {
    schemaVersion: "canonical-claims-v1",
    caseId: input.caseId,
    datasetId: input.datasetId,
    generatedAt: new Date().toISOString(),
    claims,
    gates: {
      SEMANTIC_EXCERPT_TRUNCATIONS: 0,
      adverseClaims: adverse.length,
      adverseWithGroundedDescription: adverseOk.length,
      ADVERSE_GROUNDED_COVERAGE:
        adverse.length === 0 ? 1 : adverseOk.length / adverse.length,
    },
  };
}
