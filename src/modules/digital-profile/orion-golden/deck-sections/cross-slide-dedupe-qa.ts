/**
 * C6 — Cross-slide duplicate sentence QA over SectionPacks.
 */

import type { FragmentKey, SectionPackV2, SlideBody } from "./contracts";
import type { CrossSlideDisclosurePlan } from "../contracts/cross-slide-disclosure-plan";

const EXCLUDED_FRAGMENTS = new Set<FragmentKey>([
  "FRONT_MATTER_MAIN",
  "APPENDIX_MAIN",
]);

/** Brief/matrix surfaces may share the same short theme pointer text. */
const BRIEF_FRAGMENT_KEYS = new Set<FragmentKey>([
  "DIGITAL_PROFILE_OVERVIEW",
  "EXECUTIVE_SUMMARY",
  "RISK_MATRIX",
]);

const MIN_SENTENCE_LEN = 60;

function collectTexts(body: SlideBody | undefined): string[] {
  if (!body) return [];
  const out: string[] = [];
  if (body.narrative) out.push(body.narrative);
  if (body.bullets) out.push(...body.bullets);
  if (body.whatWasFound) out.push(body.whatWasFound);
  if (body.whyItMatters) out.push(body.whyItMatters);
  if (body.whatToCheck) out.push(body.whatToCheck);
  if (body.statusNote) out.push(body.statusNote);
  return out;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s*\[finding-[^\]]+\]\s*/giu, " ")
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.replace(/\s+/gu, " ").trim())
    .filter((s) => s.length >= MIN_SENTENCE_LEN);
}

function fingerprint(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[«»"'“”]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export type CrossSlideDedupeReport = {
  CROSS_SLIDE_DUPLICATE_SENTENCES: number;
  duplicates: Array<{
    fingerprint: string;
    sample: string;
    fragments: FragmentKey[];
  }>;
  MATERIALS_WITHOUT_FULL_DISCLOSURE: number;
  MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES: number;
};

/**
 * Count identical long sentences that appear on 2+ distinct fragment keys.
 * Continuations share a fragmentKey, so pagination of the same owner is OK.
 */
export function inspectCrossSlideDuplicateSentences(
  packs: SectionPackV2[]
): Pick<CrossSlideDedupeReport, "CROSS_SLIDE_DUPLICATE_SENTENCES" | "duplicates"> {
  const byFp = new Map<string, { sample: string; fragments: Set<FragmentKey> }>();

  for (const pack of packs) {
    if (EXCLUDED_FRAGMENTS.has(pack.fragmentKey)) continue;
    for (const slide of pack.slides) {
      for (const text of collectTexts(slide.content)) {
        for (const sentence of splitSentences(text)) {
          const fp = fingerprint(sentence);
          if (fp.length < MIN_SENTENCE_LEN) continue;
          const entry = byFp.get(fp) ?? {
            sample: sentence.slice(0, 160),
            fragments: new Set<FragmentKey>(),
          };
          entry.fragments.add(pack.fragmentKey);
          byFp.set(fp, entry);
        }
      }
    }
  }

  const duplicates = [...byFp.entries()]
    .filter(([, v]) => v.fragments.size >= 2)
    .map(([fp, v]) => ({
      fingerprint: fp,
      sample: v.sample,
      fragments: [...v.fragments].sort(),
    }))
    // Shared brief among overview/executive/matrix is intentional C6.
    // Fail only when the same long sentence also leaks onto a full-owner
    // regional/theme fragment (or any non-brief surface).
    .filter((d) => !d.fragments.every((f) => BRIEF_FRAGMENT_KEYS.has(f)));

  return {
    CROSS_SLIDE_DUPLICATE_SENTENCES: duplicates.length,
    duplicates,
  };
}

/**
 * Verify each planned material's fullText appears in at most one non-excluded
 * fragment (and preferably on its fullOwnerFragment).
 */
export function inspectFullDisclosureOwnership(
  packs: SectionPackV2[],
  plan: CrossSlideDisclosurePlan | null | undefined
): Pick<
  CrossSlideDedupeReport,
  "MATERIALS_WITHOUT_FULL_DISCLOSURE" | "MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES"
> {
  if (!plan || plan.materials.length === 0) {
    return {
      MATERIALS_WITHOUT_FULL_DISCLOSURE: 0,
      MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES: 0,
    };
  }

  let missing = 0;
  let multi = 0;

  for (const m of plan.materials) {
    const needle = fingerprint(m.fullText).slice(0, 80);
    if (needle.length < 40) continue;
    const owners: FragmentKey[] = [];
    for (const pack of packs) {
      if (EXCLUDED_FRAGMENTS.has(pack.fragmentKey)) continue;
      const blob = pack.slides
        .flatMap((s) => collectTexts(s.content))
        .join("\n");
      if (fingerprint(blob).includes(needle)) {
        owners.push(pack.fragmentKey);
      }
    }
    if (owners.length === 0) missing += 1;
    else if (owners.length > 1) multi += 1;
  }

  return {
    MATERIALS_WITHOUT_FULL_DISCLOSURE: missing,
    MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES: multi,
  };
}

export function buildCrossSlideDedupeReport(
  packs: SectionPackV2[],
  plan?: CrossSlideDisclosurePlan | null
): CrossSlideDedupeReport {
  const dup = inspectCrossSlideDuplicateSentences(packs);
  const own = inspectFullDisclosureOwnership(packs, plan);
  return { ...dup, ...own };
}

/** Fail-closed C6 stop-gate. Default threshold: 0 duplicate long sentences. */
export function assertCrossSlideDedupeGatesPass(
  report: CrossSlideDedupeReport,
  opts?: { maxDuplicateSentences?: number }
): void {
  const maxDup = opts?.maxDuplicateSentences ?? 0;
  if (report.CROSS_SLIDE_DUPLICATE_SENTENCES > maxDup) {
    const sample = report.duplicates
      .slice(0, 3)
      .map((d) => `${d.fragments.join("+")}: ${d.sample}`)
      .join(" | ");
    throw new Error(
      `CROSS_SLIDE_DUPLICATE_SENTENCES=${report.CROSS_SLIDE_DUPLICATE_SENTENCES} > ${maxDup}; ${sample}`
    );
  }
  if (report.MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES !== 0) {
    throw new Error(
      `MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES=${report.MATERIALS_WITH_MULTIPLE_FULL_DISCLOSURES}`
    );
  }
}
