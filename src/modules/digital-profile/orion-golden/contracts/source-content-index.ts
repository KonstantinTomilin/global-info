/**
 * C1 — Source content acquisition index (versioned).
 * Full article bodies are stored by contentHash under the job cache; this index
 * is the durable inventory of what was acquired (no silent drops).
 */

import { z } from "zod";

export const SOURCE_CONTENT_INDEX_VERSION = "source-content-index-v1" as const;

export const ContentSourceSchema = z.enum(["full_text", "snippet_only", "unavailable"]);
export type ContentSource = z.infer<typeof ContentSourceSchema>;

export const FetchStatusSchema = z.enum([
  "fetched",
  "cached",
  "snippet_only",
  "unavailable",
  "skipped_non_article",
  "offline",
  "failed",
]);
export type FetchStatus = z.infer<typeof FetchStatusSchema>;

export const SelectionTierSchema = z.enum([
  "KEEP_PRIMARY",
  "KEEP_SUPPORTING",
  "APPENDIX_TOP_N",
]);
export type SelectionTier = z.infer<typeof SelectionTierSchema>;

export const SourceContentEntrySchema = z.object({
  evidenceRef: z.string().min(1),
  inventoryId: z.string().min(1),
  url: z.string().min(1),
  finalUrl: z.string().optional(),
  selectionTier: SelectionTierSchema,
  findingIds: z.array(z.string()).default([]),
  contentSource: ContentSourceSchema,
  fetchStatus: FetchStatusSchema,
  fetchedAt: z.string().nullable(),
  extractedTitle: z.string().nullable(),
  extractedLang: z.string().nullable(),
  sourceDate: z.string().nullable(),
  /** Full text when available — never truncated. */
  extractedText: z.string().nullable(),
  contentHash: z.string().nullable(),
  /** Relative path under artifactsDir for full-text blob (when stored separately). */
  storageRef: z.string().nullable(),
  notEligibleAsAdverseExample: z.boolean().default(false),
  errorCode: z.string().nullable().optional(),
  networkCalls: z.number().int().nonnegative().default(0),
});

export type SourceContentEntry = z.infer<typeof SourceContentEntrySchema>;

export const SourceContentCoverageSchema = z.object({
  selected: z.number().int().nonnegative(),
  fullText: z.number().int().nonnegative(),
  snippetOnly: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
  skippedNonArticle: z.number().int().nonnegative(),
  primarySupportingSelected: z.number().int().nonnegative(),
  primarySupportingFullText: z.number().int().nonnegative(),
  /** Share of PRIMARY+SUPPORTING with full_text (0..1). */
  PRIMARY_SUPPORTING_CONTENT_COVERAGE: z.number().min(0).max(1),
  SILENT_DROPS_ON_FETCH: z.literal(0),
  networkCallsTotal: z.number().int().nonnegative(),
});

export type SourceContentCoverage = z.infer<typeof SourceContentCoverageSchema>;

export const SourceContentIndexSchema = z.object({
  schemaVersion: z.literal(SOURCE_CONTENT_INDEX_VERSION),
  caseId: z.string().min(1),
  datasetId: z.string().min(1),
  generatedAt: z.string().min(1),
  entries: z.array(SourceContentEntrySchema),
  coverage: SourceContentCoverageSchema,
});

export type SourceContentIndex = z.infer<typeof SourceContentIndexSchema>;
