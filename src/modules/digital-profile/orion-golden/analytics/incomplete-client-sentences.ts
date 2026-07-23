/**
 * Shared incomplete-sentence detector for composed / theme client prose.
 * Kept in a leaf module so deck harness does not import ClientSummaryComposer.
 */

import { hasDanglingTail } from "./finding-synthesizer";

export type IncompleteSentenceOpts = {
  /**
   * `prose` (default) — strict C5 composed copy (ellipsis mid-cuts fail).
   * `pack` — SectionPack client text may embed SERP titles that end with
   * provider `...` / `…`; those must not fail C8 (live Deripaska =1).
   */
  mode?: "prose" | "pack";
};

/**
 * Detect real mid-cuts in composed prose.
 * Do NOT reuse isIncompleteClientQuote (SERP titles): it flags length under 12
 * and false-splits on «см.» / «т.д.» / initials.
 *
 * Sentences that already end with `.!?` are treated as complete — trailing
 * ellipsis / odd ASCII quotes inside a closed sentence must not fail C5.
 */
export function countIncompleteSentences(
  text: string,
  opts?: IncompleteSentenceOpts
): number {
  const mode = opts?.mode ?? "prose";
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

  const isStructuredScanLine = (p: string): boolean =>
    /^(Всего по теме|В корпусе|Где видно|Источник|Ключевой материал|Что проверить|Что делать|Другие материалы о субъекте)\s*:/iu.test(
      p
    );

  let n = 0;
  for (const p of parts) {
    // Inventory / scan lines first — SERP titles inside them may contain «…».
    if (isStructuredScanLine(p)) continue;

    // Provider / SERP ellipsis: in pack mode never fail (titles are truncated by design).
    if (/(?:\.\.\.|…)$/u.test(p)) {
      if (mode === "pack") continue;
      const stem = p.replace(/(?:\.\.\.|…)$/u, "").trim();
      if (p.length >= 48 || hasDanglingTail(stem) || /[,;]$/u.test(stem)) n += 1;
      continue;
    }
    // Closed sentence — «…текст.» / «…текст!» / «…текст».
    if (/[.!?][»"'”']?$/u.test(p) || /[»"'”'][.!?]$/u.test(p)) continue;
    // Balanced Russian theme/title card ending with ».
    if (/»$/u.test(p) && (p.match(/«/gu) ?? []).length === (p.match(/»/gu) ?? []).length) {
      continue;
    }

    // Quote attribution line: «…» — источник domain.com (domain optional after strip).
    if (/»\s*—\s*источник\b/iu.test(p) || /—\s*источник\b/iu.test(p)) {
      continue;
    }

    if (/[,;]$/u.test(p)) {
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
    // Odd ASCII "…" — only when the fragment has no Russian «» (GPT often mixes).
    const asciiQuotes = (p.match(/"/g) ?? []).length;
    const ruOpen = (p.match(/«/gu) ?? []).length;
    const ruClose = (p.match(/»/gu) ?? []).length;
    if (asciiQuotes % 2 === 1 && ruOpen === 0 && ruClose === 0) {
      n += 1;
      continue;
    }
  }
  return n;
}

/** Offending fragments for gate diagnostics (max a few). */
export function sampleIncompleteSentences(
  text: string,
  limit = 3,
  opts?: IncompleteSentenceOpts
): string[] {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized || countIncompleteSentences(normalized, opts) === 0) return [];
  const protectedText = normalized
    .replace(/\b(см|См|т|д|п|др|ул|г|гг|проф|ст|ед|им)\./gu, "$1·")
    .replace(/\b([A-ZА-ЯЁ])\.(?=\s+[A-ZА-ЯЁa-zа-яё])/gu, "$1·");
  const parts = protectedText
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.replace(/·/gu, ".").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (countIncompleteSentences(p, opts) > 0) {
      out.push(p.length > 160 ? `${p.slice(0, 160)}…` : p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Strip provider truncation markers from SERP titles before embedding in packs. */
export function sanitizeSerpTitleForClient(title: string, max = 80): string {
  return String(title ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/(?:\.\.\.|…)+\s*$/u, "")
    .replace(/[,;:\s]+$/u, "")
    .replace(/"/g, "«")
    .slice(0, max)
    .trim();
}
