/**
 * C2 — Disk cache for ItemAnalysis keyed by (contentHash|url, promptVersion, subjectId).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
  ItemAnalysisSchema,
  type ItemAnalysis,
} from "../contracts/item-analysis";

function cacheKey(input: {
  contentHash: string | null;
  url: string;
  subjectId: string;
}): string {
  const base = `${input.contentHash ?? input.url}|${GROUNDED_ITEM_ANALYST_PROMPT_VERSION}|${input.subjectId}`;
  return createHash("sha256").update(base, "utf8").digest("hex").slice(0, 32);
}

export function itemAnalysisCacheDir(artifactsDir: string): string {
  return join(artifactsDir, "item-analysis-cache");
}

export function readItemAnalysisCache(
  artifactsDir: string,
  input: { contentHash: string | null; url: string; subjectId: string }
): ItemAnalysis | null {
  const path = join(itemAnalysisCacheDir(artifactsDir), `${cacheKey(input)}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = ItemAnalysisSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return null;
    return { ...parsed.data, producedBy: "cached", guardNotes: [...parsed.data.guardNotes, "cache_hit"] };
  } catch {
    return null;
  }
}

export function writeItemAnalysisCache(
  artifactsDir: string,
  input: { contentHash: string | null; url: string; subjectId: string },
  analysis: ItemAnalysis
): void {
  const dir = itemAnalysisCacheDir(artifactsDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${cacheKey(input)}.json`);
  writeFileSync(path, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
}
