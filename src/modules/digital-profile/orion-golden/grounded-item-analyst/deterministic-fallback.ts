/**
 * C2 — Conservative deterministic fallback (never empty).
 * Builds grounded client prose strictly from title/snippet/extractedText + profile.
 */

import {
  ITEM_ANALYSIS_SCHEMA_VERSION,
  GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
  type ClaimKind,
  type ItemAnalysis,
  type SupportingSpan,
} from "../contracts/item-analysis";
import type { ContentSource } from "../contracts/source-content-index";
import { splitSentences, spanInSource } from "./grounding-guards";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "источник";
  }
}

function pickSpan(source: string, needleHints: string[]): string {
  const src = source.replace(/\s+/g, " ").trim();
  for (const hint of needleHints) {
    const h = hint.trim();
    if (h.length >= 12 && src.toLowerCase().includes(h.toLowerCase())) {
      const idx = src.toLowerCase().indexOf(h.toLowerCase());
      return src.slice(idx, Math.min(src.length, idx + Math.max(h.length, 80)));
    }
  }
  // First ~120 chars as span (must remain a real substring).
  return src.slice(0, Math.min(160, src.length));
}

export function buildDeterministicItemAnalysis(input: {
  evidenceRef: string;
  inventoryId: string;
  url: string;
  title: string;
  sourceText: string;
  contentSource: ContentSource;
  contentHash: string | null;
  theme?: string;
  subjectDisplayName: string;
}): ItemAnalysis {
  const domain = domainOf(input.url);
  const source = input.sourceText.trim() || input.title.trim() || domain;
  const title = input.title.trim() || "публикация";

  let clientDescription: string;
  let claimKind: ClaimKind;
  let attribution: string | null;
  let whyItMatters: string;
  let qualification: string;
  let checks: string[];
  let confidence: number;

  if (input.contentSource === "full_text" && source.length >= 80) {
    const gist = source.slice(0, 280).replace(/\s+/g, " ").trim();
    clientDescription = [
      `В материале ${domain} сообщается о сюжете, связанном с субъектом ${input.subjectDisplayName}: «${title}».`,
      `Авторы публикации утверждают: ${gist}${gist.endsWith(".") ? "" : "."}`,
    ].join(" ");
    claimKind = "SOURCE_ALLEGATION";
    attribution = "сообщается / утверждают";
    whyItMatters = `Для due diligence важно зафиксировать содержание публикации ${domain} по теме «${title}» и проверить, подтверждается ли оно первичными документами.`;
    qualification =
      "Наличие публикации не подтверждает изложенные утверждения; требуется проверка первичных источников.";
    checks = [
      `Сверить ключевые тезисы материала ${domain} с первичными документами`,
      "Проверить дату, авторство и наличие опровержений/уточнений",
    ];
    confidence = 0.55;
  } else {
    clientDescription = [
      `По открытым источникам найдена публикация «${title}» (${domain}).`,
      "Содержание материала автоматически раскрыть не удалось; доступны только заголовок и/или краткий сниппет выдачи.",
    ].join(" ");
    claimKind = "CONTEXT";
    attribution = null;
    whyItMatters =
      "Материал нужно учесть как сигнал для ручной проверки, без выводов о существе обвинений по сниппету.";
    qualification =
      "Содержание материала не удалось раскрыть автоматически; сниппет/заголовок не следует трактовать как доказанный факт.";
    checks = [
      `Открыть первоисточник ${domain} и зафиксировать полный текст`,
      "Не использовать заголовок как единственное доказательство adverse-темы",
    ];
    confidence = 0.35;
  }

  const sentences = splitSentences(clientDescription);
  const supportingSpans: SupportingSpan[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const quote = pickSpan(source, [title, input.subjectDisplayName]);
    if (spanInSource(quote, source) || source.includes(quote.slice(0, 20))) {
      supportingSpans.push({ sentenceIndex: i, quote });
    } else if (source.length > 0) {
      supportingSpans.push({
        sentenceIndex: i,
        quote: source.slice(0, Math.min(120, source.length)),
      });
    }
  }

  return {
    schemaVersion: ITEM_ANALYSIS_SCHEMA_VERSION,
    evidenceRef: input.evidenceRef,
    inventoryId: input.inventoryId,
    url: input.url,
    contentSource: input.contentSource,
    contentHash: input.contentHash,
    promptVersion: GROUNDED_ITEM_ANALYST_PROMPT_VERSION,
    clientDescription,
    claimKind,
    attribution,
    whyItMatters,
    qualification,
    recommendedChecks: checks,
    entities: [input.subjectDisplayName, domain].filter(Boolean),
    dates: [],
    regions: [],
    supportingSpans,
    analysisConfidence: confidence,
    producedBy: "deterministic_fallback",
    groundingOk: true,
    guardNotes: ["deterministic_fallback"],
  };
}
