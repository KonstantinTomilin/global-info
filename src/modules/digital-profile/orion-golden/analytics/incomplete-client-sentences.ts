/**
 * Shared incomplete-sentence detector for composed / theme client prose.
 * Kept in a leaf module so deck harness does not import ClientSummaryComposer.
 */

import { hasDanglingTail } from "./finding-synthesizer";

/**
 * Detect real mid-cuts in composed prose.
 * Do NOT reuse isIncompleteClientQuote (SERP titles): it flags length under 12
 * and false-splits on «см.» / «т.д.» / initials.
 */
export function countIncompleteSentences(text: string): number {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return 0;

  // Avoid splitting on common abbreviations / initials («см. », «т. д. », «О. »).
  const protectedText = normalized
    .replace(/\b(см|См|т|д|п|др|ул|г|гг|проф|ст|ед|им)\./gu, "$1·")
    .replace(/\b([A-ZА-ЯЁ])\.(?=\s+[A-ZА-ЯЁa-zа-яё])/gu, "$1·");

  const parts = protectedText
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.replace(/·/gu, ".").trim())
    .filter(Boolean);

  let n = 0;
  for (const p of parts) {
    // Labels like «Источник:» mid-paragraph are OK; trailing cut markers are not.
    if (/[,;]$/u.test(p)) {
      n += 1;
      continue;
    }
    if (/(?:\.\.\.|…)$/u.test(p) && p.length > 20) {
      n += 1;
      continue;
    }
    if (hasDanglingTail(p)) {
      n += 1;
      continue;
    }
    if (/\([^)]*$/u.test(p)) {
      n += 1;
      continue;
    }
    if (((p.match(/"/g) ?? []).length) % 2 === 1) {
      n += 1;
    }
  }
  return n;
}
