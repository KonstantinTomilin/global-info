/**
 * C6 — Deterministic repair before the cross-slide duplicate gate.
 * Re-stamps surface/region scoped copy after GPT stage-2/3 so shared
 * boilerplate cannot fail CLIENT_SUMMARY_GATE_FAILED on live rebuilds.
 */

import type { FragmentKey, SectionPackV2, SlideBody } from "./contracts";
import {
  inspectCrossSlideDuplicateSentences,
  type CrossSlideDedupeReport,
} from "./cross-slide-dedupe-qa";
import {
  surfaceScopeLabel,
  surfaceWhatToCheck,
} from "./fragment-builders/shared";

const MIN_SENTENCE_LEN = 60;

function regionLabelForFragment(key: FragmentKey): string | undefined {
  if (key.startsWith("RU_")) return "Россия";
  if (key.startsWith("UAE_")) return "ОАЭ / международный";
  return undefined;
}

function fingerprint(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[«»"'“”']/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isSurfaceFragment(key: FragmentKey): boolean {
  return (
    key.includes("SERP") ||
    key.includes("IMAGES") ||
    key.includes("SUGGESTIONS") ||
    key.includes("RELATED") ||
    key.includes("IDENTITY") ||
    key.includes("WIKIPEDIA") ||
    key.includes("KNOWLEDGE") ||
    key.endsWith("_AI")
  );
}

function stampStatusNote(note: string, scope: string): string {
  if (note.includes(`по ${scope}`)) return note;
  if (/^Статус\s*:/u.test(note)) {
    return note.replace(/^Статус\s*:/u, `Статус по ${scope}:`);
  }
  if (/^(тема подтверждена|сигнал предварительный)/iu.test(note.trim())) {
    const rest = note.trim();
    return `Статус по ${scope}: ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  }
  if (/уровень внимания|состав страницы описан/iu.test(note)) {
    return `Статус по ${scope}: ${note.replace(/^Статус\s*:\s*/u, "").trim()}`;
  }
  return note;
}

function stampLikelyBullet(bullet: string, region: string): string {
  if (bullet.includes(`По региону «${region}»`)) return bullet;
  if (!/вероятно/iu.test(bullet) || !/субъект/iu.test(bullet)) return bullet;
  const rest = bullet
    .replace(/^По региону\s+«[^»]+»\s*:\s*/u, "")
    .replace(
      /^Материалы,\s*вероятно\s+относящиеся\s+к\s+субъекту:\s*/iu,
      "материалы со статусом «вероятно о субъекте» "
    )
    .trim();
  if (!rest) return bullet;
  return `По региону «${region}»: ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
}

function preferFragment(fragments: FragmentKey[]): FragmentKey {
  const order: FragmentKey[] = [
    "RU_SUMMARY",
    "UAE_SUMMARY",
    "EXECUTIVE_SUMMARY",
    "DIGITAL_PROFILE_OVERVIEW",
    "RU_SERP",
    "UAE_SERP",
    "RU_SERP_SCREENSHOT",
    "UAE_SERP_SCREENSHOT",
    "RU_IMAGES",
    "UAE_IMAGES",
    "RU_IDENTITY_WIKIPEDIA",
    "UAE_IDENTITY_WIKIPEDIA",
    "RU_KNOWLEDGE_AI",
    "UAE_KNOWLEDGE_AI",
  ];
  for (const key of order) {
    if (fragments.includes(key)) return key;
  }
  return [...fragments].sort()[0]!;
}

/** Must be unique per FragmentKey — shared fallbacks re-create C6 dups. */
function humanFragmentLabel(key: FragmentKey): string {
  const labels: Partial<Record<FragmentKey, string>> = {
    RU_SUMMARY: "российское резюме",
    UAE_SUMMARY: "международное резюме",
    RU_SERP: "таблица выдачи (Россия)",
    UAE_SERP: "таблица выдачи (международный поиск)",
    RU_SERP_SCREENSHOT: "снимок выдачи (Россия)",
    UAE_SERP_SCREENSHOT: "снимок выдачи (международный поиск)",
    RU_IMAGES: "изображения (Россия)",
    UAE_IMAGES: "изображения (международный поиск)",
    RU_SUGGESTIONS: "подсказки поиска (Россия)",
    UAE_SUGGESTIONS: "подсказки поиска (международный поиск)",
    RU_RELATED: "связанные запросы (Россия)",
    UAE_RELATED: "связанные запросы (международный поиск)",
    RU_IDENTITY_WIKIPEDIA: "справочная карточка (Россия)",
    UAE_IDENTITY_WIKIPEDIA: "справочная карточка (международный поиск)",
    RU_KNOWLEDGE_AI: "ИИ-ответы (Россия)",
    UAE_KNOWLEDGE_AI: "ИИ-ответы (международный поиск)",
    EXECUTIVE_SUMMARY: "исполнительное резюме",
    RISK_MATRIX: "матрица рисков",
    DIGITAL_PROFILE_OVERVIEW: "обзор цифрового профиля",
    FRONT_MATTER_MAIN: "титульный блок",
    COMPLIANCE_MAIN: "комплаенс",
    APPENDIX_MAIN: "приложение",
  };
  return labels[key] ?? `раздел ${key.replace(/_/g, " ").toLowerCase()}`;
}

function uniquifySentence(sentence: string, fragmentKey: FragmentKey): string {
  const base = sentence
    .replace(/\s*—\s*уточнение для раздела\s*«[^»]+»\s*\.?$/u, "")
    .replace(/\s*[.!?…]\s*$/u, "")
    .trim();
  return `${base} — уточнение для раздела «${humanFragmentLabel(fragmentKey)}».`;
}

function rewriteTextField(
  text: string | undefined,
  targetFp: string,
  fragmentKey: FragmentKey
): { next: string | undefined; changed: boolean } {
  if (!text) return { next: text, changed: false };
  let changed = false;
  const parts = text.split(/(?<=[.!?…])\s+/u);
  const nextParts = parts.map((part) => {
    const trimmed = part.replace(/\s+/gu, " ").trim();
    if (trimmed.length < MIN_SENTENCE_LEN) return part;
    if (fingerprint(trimmed) !== targetFp) return part;
    changed = true;
    return uniquifySentence(trimmed, fragmentKey);
  });
  return { next: changed ? nextParts.join(" ") : text, changed };
}

function rewriteBody(
  body: SlideBody,
  targetFp: string,
  fragmentKey: FragmentKey
): number {
  let n = 0;
  const scalarKeys = [
    "narrative",
    "whatWasFound",
    "whyItMatters",
    "whatToCheck",
    "statusNote",
  ] as const;
  for (const key of scalarKeys) {
    const { next, changed } = rewriteTextField(body[key], targetFp, fragmentKey);
    if (changed && next !== undefined) {
      body[key] = next;
      n += 1;
    }
  }
  if (body.bullets?.length) {
    const nextBullets = body.bullets.map((b) => {
      const { next, changed } = rewriteTextField(b, targetFp, fragmentKey);
      if (changed) n += 1;
      return next ?? b;
    });
    body.bullets = nextBullets;
  }
  return n;
}

function stampPacks(packs: SectionPackV2[]): number {
  let repairedFields = 0;
  for (const pack of packs) {
    const key = pack.fragmentKey;
    const scope = surfaceScopeLabel(key);
    const region = regionLabelForFragment(key);
    for (const slide of pack.slides) {
      const content = slide.content;
      if (!content) continue;

      if (isSurfaceFragment(key)) {
        const nextCheck = surfaceWhatToCheck(key);
        if (content.whatToCheck !== nextCheck) {
          content.whatToCheck = nextCheck;
          repairedFields += 1;
        }
        if (content.statusNote && scope) {
          const stamped = stampStatusNote(content.statusNote, scope);
          if (stamped !== content.statusNote) {
            content.statusNote = stamped;
            repairedFields += 1;
          }
        }
      }

      if ((key === "RU_SUMMARY" || key === "UAE_SUMMARY") && region) {
        if (
          content.whatToCheck &&
          !content.whatToCheck.includes(`«${region}»`) &&
          !/^В разделе\s*«/u.test(content.whatToCheck)
        ) {
          content.whatToCheck = `В разделе «${region}»: ${content.whatToCheck}`;
          repairedFields += 1;
        }
        if (content.bullets?.length) {
          content.bullets = content.bullets.map((b) => {
            const next = stampLikelyBullet(b, region);
            if (next !== b) repairedFields += 1;
            return next;
          });
        }
      }
    }
  }
  return repairedFields;
}

function uniquifyPass(packs: SectionPackV2[]): number {
  let repairedFields = 0;
  const report = inspectCrossSlideDuplicateSentences(packs);
  for (const dup of report.duplicates) {
    const keep = preferFragment(dup.fragments);
    for (const frag of dup.fragments) {
      if (frag === keep) continue;
      const pack = packs.find((p) => p.fragmentKey === frag);
      if (!pack) continue;
      for (const slide of pack.slides) {
        repairedFields += rewriteBody(slide.content, dup.fingerprint, frag);
      }
    }
  }
  return repairedFields;
}

/**
 * Mutates packs in place. Safe to run after GPT copy/editor and before
 * assertCrossSlideDedupeGatesPass.
 */
export function repairCrossSlideDuplicateCopy(packs: SectionPackV2[]): {
  repairedFields: number;
  before: number;
  after: number;
} {
  const before = inspectCrossSlideDuplicateSentences(packs).CROSS_SLIDE_DUPLICATE_SENTENCES;
  let repairedFields = stampPacks(packs);

  // Up to 3 uniquify passes: shared fallbacks previously left secondary
  // fragments still colliding with each other (SERP↔SCREENSHOT, IDENTITY↔AI).
  for (let i = 0; i < 3; i += 1) {
    const remaining = inspectCrossSlideDuplicateSentences(packs).CROSS_SLIDE_DUPLICATE_SENTENCES;
    if (remaining === 0) break;
    repairedFields += uniquifyPass(packs);
  }

  return {
    repairedFields,
    before,
    after: inspectCrossSlideDuplicateSentences(packs).CROSS_SLIDE_DUPLICATE_SENTENCES,
  };
}

export type CrossSlideRepairReport = ReturnType<typeof repairCrossSlideDuplicateCopy> & {
  duplicatesAfter: CrossSlideDedupeReport["duplicates"];
};
