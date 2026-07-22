/**
 * C5 — Composed client summary (ORION-density theme blocks from grounded claims).
 */

import { z } from "zod";

export const COMPOSED_CLIENT_SUMMARY_VERSION = "composed-client-summary-v1" as const;

export const ComposedThemeArticleSchema = z.object({
  evidenceRef: z.string().min(1),
  domain: z.string().min(1),
  /** 1–2 paragraphs: grounded retelling + source + qualification. */
  body: z.string().min(1),
  whyItMatters: z.string().min(1),
  qualification: z.string().min(1),
  recommendedChecks: z.array(z.string().min(1)).min(1),
  claimId: z.string().min(1),
});

export type ComposedThemeArticle = z.infer<typeof ComposedThemeArticleSchema>;

export const ComposedThemeBlockSchema = z.object({
  themeId: z.string().min(1),
  themeLabel: z.string().min(1),
  isAdverse: z.boolean(),
  isDatabaseBlock: z.boolean(),
  /** Leading conclusion for the theme (starts with the takeaway). */
  conclusion: z.string().min(1),
  articles: z.array(ComposedThemeArticleSchema).min(1),
  /** Synthesized from article-level whyItMatters — not a theme constant. */
  whyItMatters: z.string().min(1),
  recommendedChecks: z.array(z.string().min(1)).min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
});

export type ComposedThemeBlock = z.infer<typeof ComposedThemeBlockSchema>;

export const ComposedClientSummarySchema = z.object({
  schemaVersion: z.literal(COMPOSED_CLIENT_SUMMARY_VERSION),
  caseId: z.string().min(1),
  datasetId: z.string().min(1),
  generatedAt: z.string().min(1),
  mediaThemeBlocks: z.array(ComposedThemeBlockSchema),
  databaseThemeBlocks: z.array(ComposedThemeBlockSchema),
  gates: z.object({
    SUMMARY_MATERIAL_THEME_COVERAGE: z.number().min(0).max(1),
    SUMMARY_CONCRETE_EXAMPLES_PRESENT: z.boolean(),
    PER_THEME_WHY_IS_ARTICLE_SPECIFIC: z.boolean(),
    SUMMARY_UNSUPPORTED_ASSERTIONS: z.number().int().nonnegative(),
    SUMMARY_TECHNICAL_COPY_TOKENS: z.number().int().nonnegative(),
    SUMMARY_INCOMPLETE_SENTENCES: z.number().int().nonnegative(),
    materialThemeCount: z.number().int().nonnegative(),
    coveredMaterialThemeCount: z.number().int().nonnegative(),
  }),
});

export type ComposedClientSummary = z.infer<typeof ComposedClientSummarySchema>;
