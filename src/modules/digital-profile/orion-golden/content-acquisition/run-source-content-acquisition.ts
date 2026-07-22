/**
 * C1 — SourceContentAcquisition orchestrator.
 * Offline-safe: NETWORK_CALLS=0 uses cache only; failures → snippet_only, never drop.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RawInventoryItem } from "../types";
import type { Finding } from "../contracts/finding";
import {
  SOURCE_CONTENT_INDEX_VERSION,
  type SourceContentCoverage,
  type SourceContentEntry,
  type SourceContentIndex,
} from "../contracts/source-content-index";
import { extractArticleFromHtml } from "./extract-article";
import { defaultHttpPageFetch, type PageFetchFn } from "./page-fetch";
import { selectSourceUrls } from "./select-source-urls";
import {
  entryFromCache,
  readSourceContentCache,
  writeSourceContentCache,
} from "./source-content-cache";

export type SourceContentAcquisitionInput = {
  caseId: string;
  datasetId: string;
  artifactsDir: string;
  findings: Finding[];
  items: RawInventoryItem[];
  /** Injectable fetch for offline fixtures / tests. */
  fetchPage?: PageFetchFn;
  /** When true, never call network even if NETWORK_CALLS!=0 (tests). */
  forceOffline?: boolean;
  appendixTopN?: number;
};

function snippetEntry(input: {
  evidenceRef: string;
  inventoryId: string;
  url: string;
  selectionTier: SourceContentEntry["selectionTier"];
  findingIds: string[];
  notEligibleAsAdverseExample: boolean;
  fetchStatus: SourceContentEntry["fetchStatus"];
  contentSource: SourceContentEntry["contentSource"];
  errorCode?: string | null;
  networkCalls: number;
  title?: string;
  snippet?: string;
}): SourceContentEntry {
  // Keep title/snippet as extractedTitle / leave extractedText null — body not acquired.
  return {
    evidenceRef: input.evidenceRef,
    inventoryId: input.inventoryId,
    url: input.url,
    selectionTier: input.selectionTier,
    findingIds: input.findingIds,
    contentSource: input.contentSource,
    fetchStatus: input.fetchStatus,
    fetchedAt: new Date().toISOString(),
    extractedTitle: input.title?.trim() || null,
    extractedLang: null,
    sourceDate: null,
    extractedText: input.snippet?.trim() ? input.snippet.trim() : null,
    contentHash: null,
    storageRef: null,
    notEligibleAsAdverseExample: input.notEligibleAsAdverseExample,
    errorCode: input.errorCode ?? null,
    networkCalls: input.networkCalls,
  };
}

function buildCoverage(entries: SourceContentEntry[]): SourceContentCoverage {
  const primarySupporting = entries.filter(
    (e) => e.selectionTier === "KEEP_PRIMARY" || e.selectionTier === "KEEP_SUPPORTING"
  );
  const fullText = entries.filter((e) => e.contentSource === "full_text").length;
  const snippetOnly = entries.filter((e) => e.contentSource === "snippet_only").length;
  const unavailable = entries.filter((e) => e.contentSource === "unavailable").length;
  const skippedNonArticle = entries.filter((e) => e.fetchStatus === "skipped_non_article").length;
  const psFull = primarySupporting.filter((e) => e.contentSource === "full_text").length;
  const psSelected = primarySupporting.length;
  return {
    selected: entries.length,
    fullText,
    snippetOnly,
    unavailable,
    skippedNonArticle,
    primarySupportingSelected: psSelected,
    primarySupportingFullText: psFull,
    PRIMARY_SUPPORTING_CONTENT_COVERAGE: psSelected > 0 ? psFull / psSelected : 0,
    SILENT_DROPS_ON_FETCH: 0,
    networkCallsTotal: entries.reduce((n, e) => n + (e.networkCalls ?? 0), 0),
  };
}

export async function runSourceContentAcquisition(
  input: SourceContentAcquisitionInput
): Promise<SourceContentIndex> {
  const selected = selectSourceUrls({
    findings: input.findings,
    items: input.items,
    appendixTopN: input.appendixTopN,
  });

  // Injected fetchPage is allowed under NETWORK_CALLS=0 (offline fixtures).
  // forceOffline always skips network, even with an injected fetcher.
  const offline = input.forceOffline === true;
  const networkBlocked =
    !input.fetchPage && process.env.NETWORK_CALLS === "0";
  const fetchPage = input.fetchPage ?? defaultHttpPageFetch;
  const entries: SourceContentEntry[] = [];

  // URL-level dedupe already done in select; still share in-run fetch results.
  const fetchedThisRun = new Map<string, SourceContentEntry>();

  for (const sel of selected) {
    if (fetchedThisRun.has(sel.url)) {
      const prior = fetchedThisRun.get(sel.url)!;
      entries.push({
        ...prior,
        evidenceRef: sel.evidenceRef,
        inventoryId: sel.inventoryId,
        selectionTier: sel.selectionTier,
        findingIds: sel.findingIds,
        notEligibleAsAdverseExample: sel.notEligibleAsAdverseExample,
        networkCalls: 0,
      });
      continue;
    }

    if (sel.notEligibleAsAdverseExample) {
      const entry = snippetEntry({
        ...sel,
        fetchStatus: "skipped_non_article",
        contentSource: "snippet_only",
        errorCode: "non_article_url",
        networkCalls: 0,
      });
      fetchedThisRun.set(sel.url, entry);
      entries.push(entry);
      continue;
    }

    const cached = readSourceContentCache(input.artifactsDir, sel.url);
    if (cached) {
      const storageRef = writeSourceContentCache(input.artifactsDir, cached);
      const entry = entryFromCache({
        evidenceRef: sel.evidenceRef,
        inventoryId: sel.inventoryId,
        url: sel.url,
        selectionTier: sel.selectionTier,
        findingIds: sel.findingIds,
        notEligibleAsAdverseExample: sel.notEligibleAsAdverseExample,
        blob: cached,
        storageRef,
      });
      fetchedThisRun.set(sel.url, entry);
      entries.push(entry);
      continue;
    }

    if (offline || networkBlocked) {
      const entry = snippetEntry({
        ...sel,
        fetchStatus: "offline",
        contentSource: "snippet_only",
        errorCode: offline ? "force_offline" : "NETWORK_CALLS_0_no_cache",
        networkCalls: 0,
      });
      fetchedThisRun.set(sel.url, entry);
      entries.push(entry);
      continue;
    }

    const fetched = await fetchPage({ url: sel.url });
    if (!fetched.ok || !fetched.html) {
      const entry = snippetEntry({
        ...sel,
        fetchStatus: "failed",
        contentSource: "snippet_only",
        errorCode: fetched.errorCode ?? "fetch_failed",
        networkCalls: fetched.networkCalls,
      });
      fetchedThisRun.set(sel.url, entry);
      entries.push(entry);
      continue;
    }

    const extracted = extractArticleFromHtml({
      html: fetched.html,
      url: sel.url,
      fallbackTitle: sel.title,
    });
    if (!extracted) {
      const entry = snippetEntry({
        ...sel,
        fetchStatus: "failed",
        contentSource: "snippet_only",
        errorCode: "extract_empty",
        networkCalls: fetched.networkCalls,
      });
      fetchedThisRun.set(sel.url, entry);
      entries.push(entry);
      continue;
    }

    const fetchedAt = new Date().toISOString();
    const storageRef = writeSourceContentCache(input.artifactsDir, {
      version: "source-content-cache-v1",
      url: sel.url,
      finalUrl: fetched.finalUrl,
      html: fetched.html,
      extractedText: extracted.extractedText,
      extractedTitle: extracted.extractedTitle,
      extractedLang: extracted.extractedLang,
      sourceDate: extracted.sourceDate,
      contentHash: extracted.contentHash,
      fetchedAt,
    });

    const entry: SourceContentEntry = {
      evidenceRef: sel.evidenceRef,
      inventoryId: sel.inventoryId,
      url: sel.url,
      finalUrl: fetched.finalUrl,
      selectionTier: sel.selectionTier,
      findingIds: sel.findingIds,
      contentSource: "full_text",
      fetchStatus: "fetched",
      fetchedAt,
      extractedTitle: extracted.extractedTitle,
      extractedLang: extracted.extractedLang,
      sourceDate: extracted.sourceDate,
      extractedText: extracted.extractedText,
      contentHash: extracted.contentHash,
      storageRef,
      notEligibleAsAdverseExample: false,
      errorCode: null,
      networkCalls: fetched.networkCalls,
    };
    fetchedThisRun.set(sel.url, entry);
    entries.push(entry);
  }

  // Invariant: every selected URL produced an entry (no silent drop).
  if (entries.length !== selected.length) {
    throw new Error(
      `SILENT_DROPS_ON_FETCH: selected=${selected.length} entries=${entries.length}`
    );
  }

  const index: SourceContentIndex = {
    schemaVersion: SOURCE_CONTENT_INDEX_VERSION,
    caseId: input.caseId,
    datasetId: input.datasetId,
    generatedAt: new Date().toISOString(),
    entries,
    coverage: buildCoverage(entries),
  };

  mkdirSync(input.artifactsDir, { recursive: true });
  writeFileSync(
    join(input.artifactsDir, "source-content-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(input.artifactsDir, "source-content-coverage.json"),
    `${JSON.stringify(index.coverage, null, 2)}\n`,
    "utf8"
  );

  return index;
}
