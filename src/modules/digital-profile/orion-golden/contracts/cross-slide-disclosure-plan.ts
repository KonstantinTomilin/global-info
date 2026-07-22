/**
 * C6 — Cross-slide disclosure plan: one full material reveal, brief elsewhere.
 */

import { z } from "zod";

export const CROSS_SLIDE_DISCLOSURE_PLAN_VERSION =
  "cross-slide-disclosure-plan-v1" as const;

export const DisclosureSurfaceAnglesSchema = z.object({
  serp: z.string().min(1),
  images: z.string().min(1),
  suggestions: z.string().min(1),
});

export type DisclosureSurfaceAngles = z.infer<typeof DisclosureSurfaceAnglesSchema>;

export const MaterialDisclosureSchema = z.object({
  findingId: z.string().min(1),
  themeId: z.string().min(1),
  themeLabel: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  /** Fragment that may print the full ORION-density paragraph. */
  fullOwnerFragment: z.enum([
    "RU_SUMMARY",
    "UAE_SUMMARY",
    "EXECUTIVE_SUMMARY",
  ]),
  fullText: z.string().min(1),
  /** Short exec-summary reference (not the full paragraph). */
  briefText: z.string().min(1),
  /** Risk-matrix angle — distinct from briefText to avoid cross-slide clones. */
  matrixText: z.string().min(1),
  surfaceAngles: DisclosureSurfaceAnglesSchema,
});

export type MaterialDisclosure = z.infer<typeof MaterialDisclosureSchema>;

export const CrossSlideDisclosurePlanSchema = z.object({
  schemaVersion: z.literal(CROSS_SLIDE_DISCLOSURE_PLAN_VERSION),
  caseId: z.string().min(1),
  datasetId: z.string().min(1),
  generatedAt: z.string().min(1),
  materials: z.array(MaterialDisclosureSchema),
  gates: z.object({
    MATERIALS_WITHOUT_FULL_DISCLOSURE: z.number().int().nonnegative(),
    MATERIALS_WITH_MULTIPLE_FULL_OWNERS: z.number().int().nonnegative(),
    /** Filled by deck-level QA after SectionPacks are built. */
    CROSS_SLIDE_DUPLICATE_SENTENCES: z.number().int().nonnegative(),
  }),
});

export type CrossSlideDisclosurePlan = z.infer<
  typeof CrossSlideDisclosurePlanSchema
>;
