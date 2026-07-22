/**
 * C1 — Disk cache for acquired source content (URL → entry).
 * Repeat runs with NETWORK_CALLS=0 use cache only (0 network).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceContentEntry } from "../contracts/source-content-index";

export type CachedSourceBlob = {
  version: "source-content-cache-v1";
  url: string;
  finalUrl?: string;
  html?: string;
  extractedText: string;
  extractedTitle: string | null;
  extractedLang: string | null;
  sourceDate: string | null;
  contentHash: string;
  fetchedAt: string;
};

function cacheKey(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex").slice(0, 32);
}

export function sourceContentCacheDir(artifactsDir: string): string {
  return join(artifactsDir, "source-content-cache");
}

export function readSourceContentCache(
  artifactsDir: string,
  url: string
): CachedSourceBlob | null {
  const path = join(sourceContentCacheDir(artifactsDir), `${cacheKey(url)}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CachedSourceBlob;
    if (parsed.version !== "source-content-cache-v1") return null;
    if (!parsed.extractedText || !parsed.contentHash) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSourceContentCache(
  artifactsDir: string,
  blob: CachedSourceBlob
): string {
  const dir = sourceContentCacheDir(artifactsDir);
  mkdirSync(dir, { recursive: true });
  const key = cacheKey(blob.url);
  const path = join(dir, `${key}.json`);
  writeFileSync(path, `${JSON.stringify(blob, null, 2)}\n`, "utf8");
  // Also store full text blob separately for originalFullTextRef semantics.
  const textPath = join(dir, `${key}.txt`);
  writeFileSync(textPath, blob.extractedText, "utf8");
  return `source-content-cache/${key}.txt`;
}

export function storageRefForUrl(artifactsDir: string, url: string): string | null {
  const key = cacheKey(url);
  const textPath = join(sourceContentCacheDir(artifactsDir), `${key}.txt`);
  return existsSync(textPath) ? `source-content-cache/${key}.txt` : null;
}

/** Rebuild a full_text index entry from cache without network. */
export function entryFromCache(input: {
  evidenceRef: string;
  inventoryId: string;
  url: string;
  selectionTier: SourceContentEntry["selectionTier"];
  findingIds: string[];
  notEligibleAsAdverseExample: boolean;
  blob: CachedSourceBlob;
  storageRef: string;
}): SourceContentEntry {
  return {
    evidenceRef: input.evidenceRef,
    inventoryId: input.inventoryId,
    url: input.url,
    finalUrl: input.blob.finalUrl,
    selectionTier: input.selectionTier,
    findingIds: input.findingIds,
    contentSource: "full_text",
    fetchStatus: "cached",
    fetchedAt: input.blob.fetchedAt,
    extractedTitle: input.blob.extractedTitle,
    extractedLang: input.blob.extractedLang,
    sourceDate: input.blob.sourceDate,
    extractedText: input.blob.extractedText,
    contentHash: input.blob.contentHash,
    storageRef: input.storageRef,
    notEligibleAsAdverseExample: input.notEligibleAsAdverseExample,
    errorCode: null,
    networkCalls: 0,
  };
}
