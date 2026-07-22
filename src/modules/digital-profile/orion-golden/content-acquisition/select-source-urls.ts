/**
 * C1 — Select PRIMARY/SUPPORTING (+ top-N appendix) web URLs from findings.
 * On this branch there is no ObservationDisposition ledger; we map
 * SUBJECT_MATCH + promotionPriority P1/P2 → KEEP_PRIMARY, P3 → KEEP_SUPPORTING,
 * APPENDIX → APPENDIX_TOP_N (capped).
 */

import type { RawInventoryItem } from "../types";
import type { Finding } from "../contracts/finding";
import type { SelectionTier } from "../contracts/source-content-index";
import { isNonArticleUrl, normalizeSourceUrl } from "./url-policy";

export type SelectedSourceUrl = {
  evidenceRef: string;
  inventoryId: string;
  url: string;
  selectionTier: SelectionTier;
  findingIds: string[];
  title: string;
  snippet?: string;
  notEligibleAsAdverseExample: boolean;
};

function inventoryIdFromRef(ref: string): string | null {
  const m = /^inventory:(.+)$/i.exec(ref.trim());
  return m ? m[1] : null;
}

function tierForPriority(priority: string | undefined): SelectionTier | null {
  if (priority === "P1" || priority === "P2") return "KEEP_PRIMARY";
  if (priority === "P3") return "KEEP_SUPPORTING";
  if (priority === "APPENDIX") return "APPENDIX_TOP_N";
  return null;
}

const TIER_RANK: Record<SelectionTier, number> = {
  KEEP_PRIMARY: 0,
  KEEP_SUPPORTING: 1,
  APPENDIX_TOP_N: 2,
};

/**
 * Build a deduped URL selection list. One URL → one entry; findingIds merge.
 */
export function selectSourceUrls(input: {
  findings: Finding[];
  items: RawInventoryItem[];
  appendixTopN?: number;
}): SelectedSourceUrl[] {
  const appendixTopN = input.appendixTopN ?? 10;
  const byId = new Map(input.items.map((it) => [it.inventoryId, it]));
  const byUrl = new Map<string, SelectedSourceUrl>();

  const ordered = [...input.findings].sort((a, b) => {
    const ta = tierForPriority(a.promotionPriority);
    const tb = tierForPriority(b.promotionPriority);
    const ra = ta ? TIER_RANK[ta] : 9;
    const rb = tb ? TIER_RANK[tb] : 9;
    if (ra !== rb) return ra - rb;
    return a.findingId.localeCompare(b.findingId);
  });

  let appendixCount = 0;

  for (const finding of ordered) {
    if (finding.subjectMatch !== "SUBJECT_MATCH" && finding.subjectMatch !== "LIKELY_SUBJECT") {
      continue;
    }
    const tier = tierForPriority(finding.promotionPriority);
    if (!tier) continue;
    if (tier === "APPENDIX_TOP_N") {
      if (appendixCount >= appendixTopN) continue;
    }

    for (const ref of finding.evidenceRefs) {
      const inventoryId = inventoryIdFromRef(ref);
      if (!inventoryId) continue;
      const item = byId.get(inventoryId);
      if (!item?.sourceUrl) continue;
      const url = normalizeSourceUrl(item.sourceUrl);
      if (!url) continue;

      const existing = byUrl.get(url);
      if (existing) {
        if (!existing.findingIds.includes(finding.findingId)) {
          existing.findingIds.push(finding.findingId);
        }
        if (TIER_RANK[tier] < TIER_RANK[existing.selectionTier]) {
          existing.selectionTier = tier;
        }
        continue;
      }

      if (tier === "APPENDIX_TOP_N") appendixCount += 1;

      byUrl.set(url, {
        evidenceRef: `inventory:${inventoryId}`,
        inventoryId,
        url,
        selectionTier: tier,
        findingIds: [finding.findingId],
        title: item.title,
        snippet: item.snippet,
        notEligibleAsAdverseExample: isNonArticleUrl(url),
      });
    }
  }

  return [...byUrl.values()].sort(
    (a, b) =>
      TIER_RANK[a.selectionTier] - TIER_RANK[b.selectionTier] ||
      a.url.localeCompare(b.url)
  );
}
