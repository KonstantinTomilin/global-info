/**
 * C2 — Attribution whitelist + forbidden established-fact phrasing for media allegations.
 */

export const ATTRIBUTION_VERBS = [
  "утверждает",
  "утверждают",
  "сообщает",
  "сообщается",
  "сообщают",
  "связывает",
  "связывают",
  "по данным",
  "по утверждению",
  "по версии",
  "пишет",
  "пишут",
  "описывает",
  "описывают",
  "рассматривает",
  "рассматривают",
  "claims",
  "alleges",
  "reports",
  "according to",
] as const;

/** Phrases that present a media allegation as an established legal/factual finding. */
export const FORBIDDEN_ESTABLISHED_FACT_RE =
  /\b(доказано|установлено судом|признан виновн|подтверждено официально|является коррупционером|совершил преступление)\b/i;

export function hasWhitelistedAttribution(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return false;
  const low = text.toLowerCase();
  return ATTRIBUTION_VERBS.some((v) => low.includes(v.toLowerCase()));
}

export function hasForbiddenEstablishedFact(text: string): boolean {
  return FORBIDDEN_ESTABLISHED_FACT_RE.test(text);
}
