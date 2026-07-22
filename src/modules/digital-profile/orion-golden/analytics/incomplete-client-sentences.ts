/**
 * Shared incomplete-sentence detector for composed / theme client prose.
 * Kept in a leaf module so deck harness does not import ClientSummaryComposer.
 */

import { hasDanglingTail } from "./finding-synthesizer";

/**
 * Detect real mid-cuts in composed prose.
 * Do NOT reuse isIncompleteClientQuote (SERP titles): it flags length under 12
 * and false-splits on «см.» / «т.д.» / initials.
 *
 * Sentences that already end with `.!?` are treated as complete — trailing
 * ellipsis / odd ASCII quotes inside a closed sentence must not fail C5.
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
    // Closed sentence — never count inner quotes / dangling false-positives.
    if (/[.!?]$/u.test(p)) continue;

    if (/[,;]$/u.test(p)) {
      n += 1;
      continue;
    }
    // Ellipsis / `...` without a hard stop = mid-cut for composed prose.
    if (/(?:\.\.\.|…)$/u.test(p)) {
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
      continue;
    }
    // Long fragment with no terminal punctuation at all.
    if (p.length >= 12) n += 1;
  }
  return n;
}

/** Offending fragments for gate diagnostics (max a few). */
export function sampleIncompleteSentences(text: string, limit = 3): string[] {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized || countIncompleteSentences(normalized) === 0) return [];
  const protectedText = normalized
    .replace(/\b(см|См|т|д|п|др|ул|г|гг|проф|ст|ед|им)\./gu, "$1·")
    .replace(/\b([A-ZА-ЯЁ])\.(?=\s+[A-ZА-ЯЁa-zа-яё])/gu, "$1·");
  const parts = protectedText
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.replace(/·/gu, ".").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (countIncompleteSentences(p) > 0) {
      out.push(p.length > 160 ? `${p.slice(0, 160)}…` : p);
      if (out.length >= limit) break;
    }
  }
  return out;
}
