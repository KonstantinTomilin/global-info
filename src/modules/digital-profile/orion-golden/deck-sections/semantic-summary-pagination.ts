/**
 * C7 — Theme-atomic semantic pagination.
 * A theme bullet is never mid-cut at a card boundary: if it does not fit the
 * remaining capacity, the whole block moves to a continuation slide.
 */

import type { SlideBody, SlideContentContract } from "./contracts";
import { DECK_TEMPLATE_REGISTRY, type DeckTemplateId } from "./template-registry";
import { getClientTextFieldBudgets } from "../client/load-client-text-contract";
import { chunk, splitClientParagraphs } from "./fragment-builders/shared";

/** Mid-clip / dangling markers that must stay at 0 (C7). */
const TRUNCATION_MARKERS = [
  /\([^)]{0,12}$/u, // dangling open paren from mid-clip «(в.»
  /,\s*$/u,
  /\s+(?:и|в|на|по|с|со|о|об|из|от|для)\s*\.?$/iu,
];

export type SemanticPaginationReport = {
  CLIENT_TEXT_TRUNCATIONS: number;
  themeBlocksPaginated: number;
  continuationSlides: number;
  samples: string[];
};

/**
 * Append finding marker without fitStructuredBullet / clamp — C7 atomic path.
 * Over-budget bodies are kept intact; pagination moves the whole block.
 */
export function bulletWithFindingIdAtomic(
  body: string,
  findingId: string
): string {
  const marker = ` [${findingId}]`;
  const cleaned = String(body ?? "")
    .replace(/\s*\[finding-[^\]]+\]\s*$/u, "")
    .trim();
  return cleaned ? `${cleaned}${marker}` : marker.trim();
}

export function countClientTextTruncations(texts: string[]): {
  count: number;
  samples: string[];
} {
  const samples: string[] = [];
  let count = 0;
  for (const raw of texts) {
    const lines = String(raw ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      // Ignore intentional short ellipsis in titles under 20 chars.
      if (line.length < 24) continue;
      for (const re of TRUNCATION_MARKERS) {
        if (re.test(line)) {
          count += 1;
          if (samples.length < 8) samples.push(line.slice(0, 120));
          break;
        }
      }
    }
  }
  return { count, samples };
}

/**
 * Paginate a base slide by atomic theme bullets (and optional narrative/table).
 * Unlike withContinuations, bullet packing never splits a single bullet string.
 */
export function paginateThemeBlocks(input: {
  base: SlideContentContract;
  templateId: DeckTemplateId;
  /** Override max theme bullets per page (defaults to template registry). */
  maxThemeBlocksPerSlide?: number;
}): { slides: SlideContentContract[]; report: SemanticPaginationReport } {
  const tpl = DECK_TEMPLATE_REGISTRY[input.templateId];
  const maxBlocks =
    input.maxThemeBlocksPerSlide ??
    (tpl.maxBulletsPerSlide > 0 ? tpl.maxBulletsPerSlide : 2);
  const bullets = input.base.content.bullets ?? [];
  const rows = input.base.content.table?.rows ?? [];
  const narrativeBudget = getClientTextFieldBudgets().narrative;
  const narrative = input.base.content.narrative ?? "";

  const bulletChunks =
    bullets.length > maxBlocks ? chunk(bullets, maxBlocks) : [bullets];
  const rowChunks =
    tpl.maxTableRowsPerSlide > 0 && rows.length > tpl.maxTableRowsPerSlide
      ? chunk(rows, tpl.maxTableRowsPerSlide)
      : [rows];
  const narrativeChunks =
    narrative.length > narrativeBudget
      ? splitClientParagraphs(narrative, narrativeBudget, 8)
      : [narrative || undefined];
  const total = Math.max(bulletChunks.length, rowChunks.length, narrativeChunks.length, 1);

  const slides: SlideContentContract[] = [];
  for (let i = 0; i < total; i += 1) {
    const content: SlideBody = {
      ...input.base.content,
      bullets: bulletChunks[i] ?? [],
      table: input.base.content.table
        ? { headers: input.base.content.table.headers, rows: rowChunks[i] ?? [] }
        : undefined,
    };
    if (i === 0) {
      slides.push({
        ...input.base,
        content: { ...content, narrative: narrativeChunks[0] || undefined },
      });
    } else {
      slides.push({
        ...input.base,
        slideId: `${input.base.slideId}__cont${i}`,
        isContinuation: true,
        continuationOf: input.base.slideId,
        continuationIndex: i,
        title: `${input.base.title} (продолжение ${i + 1}/${total})`,
        content: {
          ...content,
          narrative: narrativeChunks[i] || undefined,
          whatWasFound: undefined,
          whyItMatters: undefined,
        },
      });
    }
  }

  const allTexts = slides.flatMap((s) => [
    s.content.narrative ?? "",
    ...(s.content.bullets ?? []),
    s.content.whatWasFound ?? "",
    s.content.whyItMatters ?? "",
  ]);
  const trunc = countClientTextTruncations(allTexts);

  return {
    slides,
    report: {
      CLIENT_TEXT_TRUNCATIONS: trunc.count,
      themeBlocksPaginated: bullets.length,
      continuationSlides: Math.max(0, slides.length - 1),
      samples: trunc.samples,
    },
  };
}

export function assertSemanticPaginationGatesPass(
  report: SemanticPaginationReport
): void {
  if (report.CLIENT_TEXT_TRUNCATIONS !== 0) {
    throw new Error(
      `CLIENT_TEXT_TRUNCATIONS=${report.CLIENT_TEXT_TRUNCATIONS}; ${report.samples.join(" | ")}`
    );
  }
}
