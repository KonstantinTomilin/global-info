/**
 * C2 — Grounding guards: spans, entities, allegation hedging.
 */

import type { ClaimKind, SupportingSpan } from "../contracts/item-analysis";
import {
  hasForbiddenEstablishedFact,
  hasWhitelistedAttribution,
} from "./attribution";

export type GuardIssue = {
  code:
    | "MISSING_SPAN"
    | "SPAN_NOT_IN_SOURCE"
    | "HALLUCINATED_ENTITY"
    | "UNQUALIFIED_ALLEGATION"
    | "ESTABLISHED_FACT_FROM_MEDIA"
    | "EMPTY_DESCRIPTION"
    | "SNIPPET_OVERCLAIM";
  detail: string;
  sentenceIndex?: number;
};

export type GuardResult = {
  ok: boolean;
  issues: GuardIssue[];
  groundedSentenceRatio: number;
  hallucinatedEntities: string[];
};

/** Split into sentences without dropping content (RU/EN punctuation). */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?<=[.!?…])\s+(?=[A-ZА-ЯЁ«"0-9])/u).map((s) => s.trim());
  return parts.filter(Boolean);
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»""„]/g, '"')
    .trim();
}

/** Span is valid if quote appears in source (substring, case-insensitive, whitespace-normalized). */
export function spanInSource(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  const src = normalizeForMatch(sourceText);
  if (q.length < 8) return false;
  if (src.includes(q)) return true;
  // Allow short whitespace drift: collapse and compare windows.
  const qWords = q.split(" ").filter(Boolean);
  if (qWords.length < 3) return src.includes(q);
  const needle = qWords.slice(0, Math.min(12, qWords.length)).join(" ");
  return src.includes(needle);
}

/**
 * Named-entity heuristic: sequences of Capitalized tokens / Cyrillic Proper-like
 * words not present in source or allowed profile tokens → hallucinated.
 */
export function extractCandidateEntities(text: string): string[] {
  const out = new Set<string>();
  // Multi-word name-like only (reduces false positives on common Russian nouns).
  const re =
    /\b([A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+){1,3})\b/gu;
  for (const m of text.matchAll(re)) {
    const v = m[1].trim();
    if (v.length < 5) continue;
    if (
      /^(Авторы публикации|Содержание материала|Открытым источникам|Для due)$/iu.test(v)
    ) {
      continue;
    }
    out.add(v);
  }
  return [...out];
}

export function entityAllowed(
  entity: string,
  sourceText: string,
  allowedProfileTokens: string[]
): boolean {
  const e = normalizeForMatch(entity);
  if (normalizeForMatch(sourceText).includes(e)) return true;
  for (const token of allowedProfileTokens) {
    const t = normalizeForMatch(token);
    if (!t) continue;
    if (e.includes(t) || t.includes(e)) return true;
  }
  return false;
}

export function validateItemAnalysisGrounding(input: {
  clientDescription: string;
  claimKind: ClaimKind;
  attribution: string | null;
  supportingSpans: SupportingSpan[];
  sourceText: string;
  allowedProfileTokens: string[];
  contentSource: "full_text" | "snippet_only" | "unavailable";
  entities?: string[];
}): GuardResult {
  const issues: GuardIssue[] = [];
  const sentences = splitSentences(input.clientDescription);
  if (sentences.length === 0) {
    return {
      ok: false,
      issues: [{ code: "EMPTY_DESCRIPTION", detail: "empty clientDescription" }],
      groundedSentenceRatio: 0,
      hallucinatedEntities: [],
    };
  }

  let grounded = 0;
  for (let i = 0; i < sentences.length; i++) {
    const spans = input.supportingSpans.filter((s) => s.sentenceIndex === i);
    if (spans.length === 0) {
      issues.push({
        code: "MISSING_SPAN",
        detail: `sentence ${i} has no supportingSpans`,
        sentenceIndex: i,
      });
      continue;
    }
    const okSpan = spans.some((s) => spanInSource(s.quote, input.sourceText));
    if (!okSpan) {
      issues.push({
        code: "SPAN_NOT_IN_SOURCE",
        detail: `sentence ${i} spans not found in source`,
        sentenceIndex: i,
      });
      continue;
    }
    grounded += 1;
  }

  if (input.claimKind === "SOURCE_ALLEGATION") {
    const attrOk =
      hasWhitelistedAttribution(input.attribution) ||
      hasWhitelistedAttribution(input.clientDescription);
    if (!attrOk) {
      issues.push({
        code: "UNQUALIFIED_ALLEGATION",
        detail: "SOURCE_ALLEGATION without whitelisted attribution verb",
      });
    }
  }

  if (
    input.claimKind === "SOURCE_ALLEGATION" &&
    hasForbiddenEstablishedFact(input.clientDescription)
  ) {
    issues.push({
      code: "ESTABLISHED_FACT_FROM_MEDIA",
      detail: "media allegation phrased as established fact",
    });
  }

  if (input.contentSource === "snippet_only") {
    // Overclaim: long multi-detail narrative from snippet alone
    if (sentences.length > 2 && input.clientDescription.length > 420) {
      issues.push({
        code: "SNIPPET_OVERCLAIM",
        detail: "snippet_only description too elaborate",
      });
    }
  }

  const candidates = [
    ...(input.entities ?? []),
    ...extractCandidateEntities(input.clientDescription),
  ];
  const hallucinated: string[] = [];
  for (const ent of candidates) {
    if (!entityAllowed(ent, input.sourceText, input.allowedProfileTokens)) {
      hallucinated.push(ent);
      issues.push({
        code: "HALLUCINATED_ENTITY",
        detail: `entity not in source/profile: ${ent}`,
      });
    }
  }

  const groundedSentenceRatio = grounded / sentences.length;
  const ok =
    issues.length === 0 &&
    groundedSentenceRatio >= 1 &&
    hallucinated.length === 0;

  return { ok, issues, groundedSentenceRatio, hallucinatedEntities: hallucinated };
}
