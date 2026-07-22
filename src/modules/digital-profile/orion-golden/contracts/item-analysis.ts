/**
 * C2 — Grounded per-item analysis (versioned).
 */

import { z } from "zod";
import { ContentSourceSchema } from "./source-content-index";

export const ITEM_ANALYSIS_SCHEMA_VERSION = "item-analysis-v1" as const;
export const GROUNDED_ITEM_ANALYST_PROMPT_VERSION = "grounded-item-analyst-v1" as const;

export const ClaimKindSchema = z.enum([
  "FACT",
  "SOURCE_ALLEGATION",
  "DATABASE_STATUS",
  "OFFICIAL_RECORD",
  "CONTEXT",
]);
export type ClaimKind = z.infer<typeof ClaimKindSchema>;

export const SupportingSpanSchema = z.object({
  /** 0-based sentence index within clientDescription. */
  sentenceIndex: z.number().int().nonnegative(),
  /** Verbatim fragment from source text (extractedText or title+snippet). */
  quote: z.string().min(1),
});
export type SupportingSpan = z.infer<typeof SupportingSpanSchema>;

export const ItemAnalysisSchema = z.object({
  schemaVersion: z.literal(ITEM_ANALYSIS_SCHEMA_VERSION),
  evidenceRef: z.string().min(1),
  inventoryId: z.string().min(1),
  url: z.string().min(1),
  contentSource: ContentSourceSchema,
  contentHash: z.string().nullable(),
  promptVersion: z.literal(GROUNDED_ITEM_ANALYST_PROMPT_VERSION),
  clientDescription: z.string().min(1),
  claimKind: ClaimKindSchema,
  attribution: z.string().nullable(),
  whyItMatters: z.string().min(1),
  qualification: z.string().min(1),
  recommendedChecks: z.array(z.string().min(1)).min(1),
  entities: z.array(z.string()),
  dates: z.array(z.string()),
  regions: z.array(z.string()),
  supportingSpans: z.array(SupportingSpanSchema),
  analysisConfidence: z.number().min(0).max(1),
  /** How the analysis was produced. */
  producedBy: z.enum(["llm", "llm_repaired", "deterministic_fallback", "cached"]),
  groundingOk: z.boolean(),
  guardNotes: z.array(z.string()).default([]),
});

export type ItemAnalysis = z.infer<typeof ItemAnalysisSchema>;

export const ItemAnalysisBundleSchema = z.object({
  schemaVersion: z.literal("item-analysis-bundle-v1"),
  caseId: z.string().min(1),
  datasetId: z.string().min(1),
  promptVersion: z.literal(GROUNDED_ITEM_ANALYST_PROMPT_VERSION),
  generatedAt: z.string().min(1),
  analyses: z.array(ItemAnalysisSchema),
  groundingReport: z.object({
    analyzed: z.number().int().nonnegative(),
    groundedSentenceRatio: z.number().min(0).max(1),
    HALLUCINATED_ENTITIES: z.number().int().nonnegative(),
    UNQUALIFIED_MEDIA_ALLEGATIONS: z.number().int().nonnegative(),
    EMPTY_OR_SILENT_DROP: z.literal(0),
    GROUNDED_SENTENCE_RATIO: z.number().min(0).max(1),
    fallbackCount: z.number().int().nonnegative(),
    llmCount: z.number().int().nonnegative(),
    SUBJECT_UNIVERSALITY_PASS: z.boolean(),
  }),
  fallbackReport: z.object({
    count: z.number().int().nonnegative(),
    reasons: z.array(z.string()),
  }),
});

export type ItemAnalysisBundle = z.infer<typeof ItemAnalysisBundleSchema>;
