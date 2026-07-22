/**
 * C3 — CanonicalClaim: grounded client claim carrying ItemAnalysis fields.
 * displayExcerpt is always the full clientDescription (never slice-truncated).
 */

import { z } from "zod";
import {
  ClaimKindSchema,
  SupportingSpanSchema,
} from "./item-analysis";
import { ContentSourceSchema } from "./source-content-index";
import { RiskLevelSchema } from "./common";

export const CANONICAL_CLAIM_SCHEMA_VERSION = "canonical-claim-v1" as const;

export const CanonicalClaimSchema = z.object({
  schemaVersion: z.literal(CANONICAL_CLAIM_SCHEMA_VERSION),
  claimId: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  inventoryId: z.string().min(1),
  url: z.string().min(1),
  theme: z.string().min(1),
  isAdverseTheme: z.boolean(),
  riskLevel: RiskLevelSchema,
  clientDescription: z.string().min(1),
  /** Always equals clientDescription — never mechanically truncated. */
  displayExcerpt: z.string().min(1),
  claimKind: ClaimKindSchema,
  attribution: z.string().nullable(),
  qualification: z.string().min(1),
  recommendedChecks: z.array(z.string().min(1)).min(1),
  whyItMatters: z.string().min(1),
  supportingSpans: z.array(SupportingSpanSchema),
  contentSource: ContentSourceSchema,
  /** Ref to full extracted text blob when available (originalFullTextRef). */
  originalFullTextRef: z.string().nullable(),
  contentHash: z.string().nullable(),
  findingIds: z.array(z.string()),
  /** Count of semantic truncations applied to displayExcerpt (must stay 0). */
  semanticExcerptTruncations: z.literal(0),
});

export type CanonicalClaim = z.infer<typeof CanonicalClaimSchema>;

export const CanonicalClaimBundleSchema = z.object({
  schemaVersion: z.literal("canonical-claims-v1"),
  caseId: z.string().min(1),
  datasetId: z.string().min(1),
  generatedAt: z.string().min(1),
  claims: z.array(CanonicalClaimSchema),
  gates: z.object({
    SEMANTIC_EXCERPT_TRUNCATIONS: z.literal(0),
    adverseClaims: z.number().int().nonnegative(),
    adverseWithGroundedDescription: z.number().int().nonnegative(),
    ADVERSE_GROUNDED_COVERAGE: z.number().min(0).max(1),
  }),
});

export type CanonicalClaimBundle = z.infer<typeof CanonicalClaimBundleSchema>;
