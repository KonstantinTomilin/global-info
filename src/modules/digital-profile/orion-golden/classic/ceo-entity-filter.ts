/**
 * Subject-relevance filter for CEO first-36 media and observations.
 */

import type { ReportAssetV1 } from "../../orion-report-spec/asset-builder";
import type { SnapshotObservation } from "./report-evidence-snapshot";
import { isDemoOrPlaceholderClientText } from "./orion-classic-text-utils";

const AD_RE =
  /реклам|обучен|курс|купить|скидк|promo|advert|training course|enroll|subscribe/i;
const MUSIC_BOOK_RE =
  /музык|симфони|опер|книг|роман|composer|symphony|opera|novel|sheet music|ноты/i;
const WRONG_PERSON_RE =
  /николаевич|sergey nikolaevich|sergei nikolaevich|козлов|kozlov/i;

function subjectTokens(subjectName: string): string[] {
  const parts = subjectName
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3);
  const unique = [...new Set(parts)];
  // Russian FIO: surname is the first token in display order.
  return unique;
}

function blobOf(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\s-]/gu, " ");
}

const TRANSLIT_EQUIV: Array<[RegExp, string]> = [
  [/\bglinka\b/g, "глинка"],
  [/\bsergey\b/g, "сергей"],
  [/\bsergei\b/g, "сергей"],
  [/\bmikhailovich\b/g, "михайлович"],
  [/\bmihailovich\b/g, "михайлович"],
];

function expandTextVariants(text: string): string {
  let out = normalizeForMatch(text);
  for (const [re, repl] of TRANSLIT_EQUIV) {
    out = out.replace(re, repl);
  }
  return out;
}

export function isSubjectRelevantText(subjectName: string, text: string): boolean {
  const t = expandTextVariants(blobOf([text]));
  if (!t.trim()) return false;
  if (isDemoOrPlaceholderClientText(t)) return false;
  if (AD_RE.test(t)) return false;
  if (MUSIC_BOOK_RE.test(t) && !subjectTokens(subjectName).some((tok) => t.includes(tok))) {
    return false;
  }
  if (WRONG_PERSON_RE.test(t)) return false;

  const tokens = subjectTokens(subjectName).map((tok) => expandTextVariants(tok));
  if (tokens.length === 0) return true;
  const haystack = expandTextVariants(t);
  const surname = expandTextVariants(tokens[0] ?? "");
  if (!surname || !haystack.includes(surname)) return false;
  if (tokens.length === 1) return true;
  return tokens.slice(1).some((tok) => haystack.includes(tok));
}

export function filterSubjectRelevantObservation(
  subjectName: string,
  obs: SnapshotObservation
): boolean {
  const blob = blobOf([obs.title, obs.snippet, obs.url, obs.domain, obs.queryText]);
  if (!isSubjectRelevantText(subjectName, blob)) return false;
  return true;
}

export function filterCeoReportAssets(
  subjectName: string,
  assets: ReportAssetV1[]
): ReportAssetV1[] {
  return assets
    .filter((a) => {
      const blob = blobOf([a.title, a.caption, a.sourceUrl, a.assetRef]);
      if (isDemoOrPlaceholderClientText(blob)) return false;
      if (a.kind === "image_grid" || a.kind === "knowledge_panel") {
        return isSubjectRelevantText(subjectName, blob);
      }
      return true;
    })
    .map((a) => {
      if (isDemoOrPlaceholderClientText(a.title ?? "") || isDemoOrPlaceholderClientText(a.caption ?? "")) {
        return { ...a, status: "missing" as const, failureReason: "demo_fixture_rejected" };
      }
      return a;
    });
}

export function assetByRegion(
  assets: ReportAssetV1[],
  region: "RU" | "UAE",
  kind?: ReportAssetV1["kind"]
): ReportAssetV1[] {
  return assets.filter((a) => {
    if (a.status !== "ready") return false;
    if (kind && a.kind !== kind) return false;
    return a.region === region;
  });
}
