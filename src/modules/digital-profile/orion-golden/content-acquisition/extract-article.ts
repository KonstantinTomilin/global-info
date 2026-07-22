/**
 * C1 — Article body extraction (Readability + linkedom).
 * extractedText is never truncated.
 *
 * Import resolution is defensive: Next/webpack CJS↔ESM interop can leave
 * named exports undefined (live: "fz is not a function" on parseHTML).
 * This module must never throw into canonical prepare — return null instead.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { Readability as ReadabilityType } from "@mozilla/readability";

export type ExtractedArticle = {
  extractedText: string;
  extractedTitle: string | null;
  extractedLang: string | null;
  sourceDate: string | null;
  contentHash: string;
};

type ParseHtmlFn = (html: string) => { document: Document };
type ReadabilityCtor = new (
  doc: Document,
  options?: { charThreshold?: number }
) => InstanceType<typeof ReadabilityType>;

const nodeRequire = createRequire(__filename);

function resolveParseHTML(): ParseHtmlFn {
  const mod = nodeRequire("linkedom") as {
    parseHTML?: ParseHtmlFn;
    default?: { parseHTML?: ParseHtmlFn } | ParseHtmlFn;
  };
  if (typeof mod.parseHTML === "function") return mod.parseHTML;
  if (typeof mod.default === "function") return mod.default as ParseHtmlFn;
  if (mod.default && typeof mod.default.parseHTML === "function") {
    return mod.default.parseHTML;
  }
  throw new Error("linkedom.parseHTML unavailable after module resolve");
}

function resolveReadability(): ReadabilityCtor | null {
  const mod = nodeRequire("@mozilla/readability") as {
    Readability?: ReadabilityCtor;
    default?: { Readability?: ReadabilityCtor } | ReadabilityCtor;
  };
  if (typeof mod.Readability === "function") return mod.Readability;
  if (typeof mod.default === "function") return mod.default as ReadabilityCtor;
  if (mod.default && typeof mod.default.Readability === "function") {
    return mod.default.Readability;
  }
  return null;
}

function detectLang(text: string, htmlLang: string | null): string | null {
  if (htmlLang && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(htmlLang)) {
    return htmlLang.slice(0, 2).toLowerCase();
  }
  const sample = text.slice(0, 2000);
  const cyr = (sample.match(/[\u0400-\u04FF]/g) ?? []).join("").length;
  const lat = (sample.match(/[A-Za-z]/g) ?? []).join("").length;
  if (cyr + lat < 40) return null;
  return cyr >= lat ? "ru" : "en";
}

function stripNoise(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract main article text from HTML. Full text preserved (no slice).
 * Returns null on empty/unsupported input; never throws into the prepare path.
 */
export function extractArticleFromHtml(input: {
  html: string;
  url: string;
  fallbackTitle?: string;
}): ExtractedArticle | null {
  try {
    if (!input.html || input.html.trim().length < 40) return null;

    const parseHTML = resolveParseHTML();
    const { document } = parseHTML(input.html);
    const htmlLang =
      document.documentElement?.getAttribute?.("lang") ??
      document.querySelector("html")?.getAttribute("lang") ??
      null;

    let title: string | null = null;
    let text = "";
    let sourceDate: string | null = null;

    const Readability = resolveReadability();
    if (Readability) {
      try {
        const reader = new Readability(document as unknown as Document, {
          charThreshold: 80,
        });
        const article = reader.parse();
        if (article?.textContent && article.textContent.trim().length >= 80) {
          text = stripNoise(article.textContent);
          title = article.title?.trim() || null;
        }
      } catch {
        // Fall through to heuristic.
      }
    }

    if (!text || text.length < 80) {
      const main =
        document.querySelector("article") ??
        document.querySelector("main") ??
        document.querySelector("[role='main']") ??
        document.body;
      const raw = main?.textContent ?? "";
      text = stripNoise(raw);
    }

    if (!title) {
      title =
        document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() ||
        document.querySelector("title")?.textContent?.trim() ||
        input.fallbackTitle?.trim() ||
        null;
    }

    const timeEl =
      document.querySelector("meta[property='article:published_time']")?.getAttribute("content") ||
      document.querySelector("time[datetime]")?.getAttribute("datetime") ||
      null;
    if (timeEl && timeEl.trim()) sourceDate = timeEl.trim();

    if (!text || text.length < 40) return null;

    const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
    return {
      extractedText: text,
      extractedTitle: title,
      extractedLang: detectLang(text, htmlLang),
      sourceDate,
      contentHash,
    };
  } catch {
    return null;
  }
}
