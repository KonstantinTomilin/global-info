/**
 * C4 — Evidence-quality gate for client-facing adverse examples.
 * Junk/meme/social/SEO-bio → APPENDIX_OTHER with full trace (no silent drop).
 */

import type { ThemeDef } from "../../config/finding-themes";
import type { RawInventoryItem } from "../types";
import type { ContentSource } from "../contracts/source-content-index";
import { isNonArticleUrl, normalizeSourceUrl } from "../content-acquisition/url-policy";

export type ExampleDisposition = "ADVERSE_EXAMPLE" | "APPENDIX_OTHER";

export type AdverseExampleGateResult = {
  eligibleAsAdverseExample: boolean;
  disposition: ExampleDisposition;
  reason: string;
};

const MEME_TITLE_RE =
  /memes?|😭|😂|попой|https?:\/\/\S+|#[\wа-яё]+|organized crime group,\s*officials,\s*girls/iu;

/**
 * Content-aware eligibility for using a material as an adverse-theme example.
 * Optional `weakTitle` lets callers inject finding-synthesizer.isWeakExampleTitle
 * without a circular import.
 */
export function evaluateAdverseExampleEligibility(input: {
  title: string;
  url?: string | null;
  contentSource?: ContentSource | null;
  notEligibleAsAdverseExample?: boolean;
  theme?: ThemeDef;
  /** When true, treat title as weak (bare FIO / SEO bio / truncated). */
  weakTitle?: boolean;
}): AdverseExampleGateResult {
  const title = String(input.title ?? "").trim();
  const url = input.url ? normalizeSourceUrl(input.url) ?? input.url : null;

  if (input.notEligibleAsAdverseExample) {
    return {
      eligibleAsAdverseExample: false,
      disposition: "APPENDIX_OTHER",
      reason: "notEligibleAsAdverseExample",
    };
  }
  if (url && isNonArticleUrl(url)) {
    return {
      eligibleAsAdverseExample: false,
      disposition: "APPENDIX_OTHER",
      reason: "non_article_url",
    };
  }
  if (MEME_TITLE_RE.test(title)) {
    return {
      eligibleAsAdverseExample: false,
      disposition: "APPENDIX_OTHER",
      reason: "meme_or_junk_title",
    };
  }
  if (input.weakTitle) {
    return {
      eligibleAsAdverseExample: false,
      disposition: "APPENDIX_OTHER",
      reason: "weak_example_title",
    };
  }

  if (input.contentSource === "full_text") {
    return {
      eligibleAsAdverseExample: true,
      disposition: "ADVERSE_EXAMPLE",
      reason: "full_text",
    };
  }

  if (input.theme?.keywords?.test(title) && title.length >= 24) {
    return {
      eligibleAsAdverseExample: true,
      disposition: "ADVERSE_EXAMPLE",
      reason: "clean_thematic_title",
    };
  }

  if (
    !input.contentSource ||
    input.contentSource === "snippet_only" ||
    input.contentSource === "unavailable"
  ) {
    return {
      eligibleAsAdverseExample: false,
      disposition: "APPENDIX_OTHER",
      reason: "snippet_without_thematic_title",
    };
  }

  return {
    eligibleAsAdverseExample: true,
    disposition: "ADVERSE_EXAMPLE",
    reason: "default_pass",
  };
}

export function itemAdverseExampleEligibility(
  item: RawInventoryItem,
  theme?: ThemeDef,
  weakTitle?: boolean
): AdverseExampleGateResult {
  const meta = (item.rawMetadata ?? {}) as Record<string, unknown>;
  const contentSource =
    typeof meta.contentSource === "string"
      ? (meta.contentSource as ContentSource)
      : null;
  const notEligible = Boolean(meta.notEligibleAsAdverseExample);
  return evaluateAdverseExampleEligibility({
    title: item.title,
    url: item.sourceUrl,
    contentSource,
    notEligibleAsAdverseExample: notEligible,
    theme,
    weakTitle,
  });
}

export type EvidenceQualityDispositionEntry = {
  evidenceRef: string;
  inventoryId: string;
  url: string | null;
  title: string;
  themeId?: string;
  disposition: ExampleDisposition;
  reason: string;
  contentSource?: ContentSource | null;
};

export type EvidenceQualityDisposition = {
  schemaVersion: "evidence-quality-disposition-v1";
  caseId: string;
  datasetId: string;
  generatedAt: string;
  entries: EvidenceQualityDispositionEntry[];
  gates: {
    JUNK_AS_ADVERSE_EXAMPLE: number;
    appendixCount: number;
    adverseExampleCount: number;
  };
};

/**
 * Build disposition ledger for selected materials.
 * Rejected junk stays in APPENDIX_OTHER (never dropped).
 */
export function buildEvidenceQualityDisposition(input: {
  caseId: string;
  datasetId: string;
  items: Array<{
    inventoryId: string;
    title: string;
    url?: string | null;
    contentSource?: ContentSource | null;
    notEligibleAsAdverseExample?: boolean;
    themeId?: string;
    theme?: ThemeDef;
    weakTitle?: boolean;
  }>;
}): EvidenceQualityDisposition {
  const entries: EvidenceQualityDispositionEntry[] = [];
  let junkAsAdverse = 0;
  let appendix = 0;
  let adverse = 0;

  for (const it of input.items) {
    const gate = evaluateAdverseExampleEligibility({
      title: it.title,
      url: it.url,
      contentSource: it.contentSource,
      notEligibleAsAdverseExample: it.notEligibleAsAdverseExample,
      theme: it.theme,
      weakTitle: it.weakTitle,
    });
    if (gate.disposition === "APPENDIX_OTHER") appendix += 1;
    else adverse += 1;
    if (
      gate.eligibleAsAdverseExample &&
      (it.notEligibleAsAdverseExample ||
        (it.url && isNonArticleUrl(it.url)) ||
        MEME_TITLE_RE.test(it.title))
    ) {
      junkAsAdverse += 1;
    }
    entries.push({
      evidenceRef: `inventory:${it.inventoryId}`,
      inventoryId: it.inventoryId,
      url: it.url ?? null,
      title: it.title,
      themeId: it.themeId,
      disposition: gate.disposition,
      reason: gate.reason,
      contentSource: it.contentSource ?? null,
    });
  }

  return {
    schemaVersion: "evidence-quality-disposition-v1",
    caseId: input.caseId,
    datasetId: input.datasetId,
    generatedAt: new Date().toISOString(),
    entries,
    gates: {
      JUNK_AS_ADVERSE_EXAMPLE: junkAsAdverse,
      appendixCount: appendix,
      adverseExampleCount: adverse,
    },
  };
}
