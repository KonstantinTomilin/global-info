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
  // English glue left by title mid-cuts («…and H», «Sanctions on Russ»).
  /\s+(?:and|or|of|the|to|for|with|from|by|on|in|at)\s+[A-Za-zА-Яа-яЁё]{1,4}\.?$/u,
  /\s+(?:and|or|of|the|to|for|with|from|by|on|in|at)\s*\.?$/iu,
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
 * How many theme cards fit above the footer for this chrome density.
 * Registry maxBulletsPerSlide assumes ~300-char cards; C6 full-disclosure
 * bullets (600–1200+) with KPI scorecards overflow (live RENDER p10:
 * «3 theme block(s) need … EMU but only … available»).
 */
export function resolveMaxThemeBlocksPerSlide(input: {
  bullets: string[];
  templateId: DeckTemplateId;
  hasKpiChrome?: boolean;
}): number {
  const registryMax = DECK_TEMPLATE_REGISTRY[input.templateId]?.maxBulletsPerSlide ?? 2;
  if (registryMax <= 0) return 1;
  const maxLen = Math.max(0, ...input.bullets.map((b) => String(b ?? "").length));
  const hasKpi = Boolean(input.hasKpiChrome);
  if (input.templateId === "regional-summary" || input.templateId === "finding-cards") {
    if (hasKpi && maxLen >= 360) return 1;
    if (maxLen >= 700) return 1;
    if (hasKpi || maxLen >= 360) return Math.min(2, registryMax);
  }
  if (input.templateId === "continuation") {
    return maxLen >= 360 ? 1 : Math.min(2, registryMax || 2);
  }
  return Math.min(registryMax, maxLen >= 500 ? 2 : registryMax);
}

/**
 * Paginate a base slide by atomic theme bullets (and optional narrative/table).
 * Unlike withContinuations, bullet packing never splits a single bullet string.
 */
export function paginateThemeBlocks(input: {
  base: SlideContentContract;
  templateId: DeckTemplateId;
  /** Override max theme bullets per page (defaults to density-aware registry). */
  maxThemeBlocksPerSlide?: number;
}): { slides: SlideContentContract[]; report: SemanticPaginationReport } {
  const tpl = DECK_TEMPLATE_REGISTRY[input.templateId];
  const bullets = input.base.content.bullets ?? [];
  const maxBlocks =
    input.maxThemeBlocksPerSlide ??
    resolveMaxThemeBlocksPerSlide({
      bullets,
      templateId: input.templateId,
      hasKpiChrome: (input.base.content.kpis?.length ?? 0) > 0,
    });
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
          // Continuations are theme-only: drop scorecard chrome so long C6
          // cards get the full page (KPI row on every cont caused p10 overflow).
          narrative: narrativeChunks[i] || undefined,
          whatWasFound: undefined,
          whyItMatters: undefined,
          whatToCheck: undefined,
          kpis: undefined,
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

type ThemePackLike = {
  fragmentKey: string;
  slides: SlideContentContract[];
};

const REPAGE_FRAGMENTS = new Set([
  "RU_SUMMARY",
  "UAE_SUMMARY",
  "DIGITAL_PROFILE_OVERVIEW",
  "EXECUTIVE_SUMMARY",
  "APPENDIX_MAIN",
  "COMPLIANCE_MAIN",
]);

const REPAGE_TEMPLATES = new Set([
  "regional-summary",
  "finding-cards",
  "continuation",
]);

/**
 * Safety net after GPT / stale cache: flatten theme bullets for each
 * theme-bearing base + continuations and re-chunk with density-aware limits
 * so the Python renderer never sees 3+ long cards on one page.
 */
export function repaginateThemeBearingPacks(packs: ThemePackLike[]): number {
  let repaired = 0;
  for (const pack of packs) {
    if (!REPAGE_FRAGMENTS.has(pack.fragmentKey)) continue;
    const bases = pack.slides.filter(
      (s) => REPAGE_TEMPLATES.has(s.templateId) && !s.isContinuation
    );
    for (const base of bases) {
      const conts = pack.slides
        .filter((s) => s.isContinuation && s.continuationOf === base.slideId)
        .sort((a, b) => (a.continuationIndex ?? 0) - (b.continuationIndex ?? 0));
      const allBullets = [
        ...(base.content.bullets ?? []),
        ...conts.flatMap((c) => c.content.bullets ?? []),
      ];
      if (allBullets.length === 0) continue;
      const templateId = base.templateId as DeckTemplateId;
      const maxBlocks = resolveMaxThemeBlocksPerSlide({
        bullets: allBullets,
        templateId,
        hasKpiChrome: (base.content.kpis?.length ?? 0) > 0,
      });
      const expectedPages = Math.max(1, Math.ceil(allBullets.length / maxBlocks));
      const pageBulletCounts = [base, ...conts].map((s) => s.content.bullets?.length ?? 0);
      const ok =
        pageBulletCounts.length === expectedPages &&
        pageBulletCounts.every((n) => n <= maxBlocks) &&
        pageBulletCounts.reduce((a, b) => a + b, 0) === allBullets.length;
      if (ok) continue;

      const { slides: rebuilt } = paginateThemeBlocks({
        base: {
          ...base,
          isContinuation: false,
          continuationOf: null,
          continuationIndex: null,
          content: { ...base.content, bullets: allBullets },
        },
        templateId:
          templateId === "finding-cards" || templateId === "continuation"
            ? templateId
            : "regional-summary",
        maxThemeBlocksPerSlide: maxBlocks,
      });
      const baseIdx = pack.slides.findIndex((s) => s.slideId === base.slideId);
      if (baseIdx < 0) continue;
      pack.slides = [
        ...pack.slides.slice(0, baseIdx),
        ...rebuilt,
        ...pack.slides
          .slice(baseIdx + 1)
          .filter((s) => !(s.isContinuation && s.continuationOf === base.slideId)),
      ];
      repaired += 1;
    }
  }
  return repaired;
}
