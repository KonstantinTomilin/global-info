/**
 * C6 — Plan one full disclosure per material; brief + surface angles elsewhere.
 */

import type { Finding } from "../contracts/finding";
import type { ComposedClientSummary, ComposedThemeBlock } from "../contracts/composed-client-summary";
import {
  CROSS_SLIDE_DISCLOSURE_PLAN_VERSION,
  type CrossSlideDisclosurePlan,
  type MaterialDisclosure,
} from "../contracts/cross-slide-disclosure-plan";
import { resolveThemeRef } from "./canonical-claim-builder";
import { themeBlockToClaimText } from "./client-summary-composer";

/** Keep brief/matrix concrete but shorter than full ORION prose. */
function clipConcrete(text: string, max: number): string {
  const flat = String(text ?? "")
    .replace(/\s+/gu, " ")
    .replace(/^В материале\s+\S+\s+(?:сообщается|утверждается)\s*—\s*/u, "")
    .trim();
  if (!flat) return "";
  if (flat.length <= max) return /[.!?…]$/u.test(flat) ? flat : `${flat}.`;
  const slice = flat.slice(0, max);
  const punct = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  const cut = punct > 40 ? slice.slice(0, punct + 1).trim() : slice.replace(/\s+\S*$/u, "").trim();
  return /[.!?…]$/u.test(cut) ? cut : `${cut}.`;
}

function briefFromBlock(block: ComposedThemeBlock): string {
  // Live Deripaska PDF-51 — previous meta brief («зафиксирована тема… полный
  // разбор в разделе») emptied the executive of FBK/court concreteness.
  // Brief must carry a real allegation + why, while staying shorter/distinct
  // from fullText (different framing → C6 dedupe).
  const art = block.articles[0];
  const domains = block.articles.map((a) => a.domain).slice(0, 2).join(", ");
  const allegation = art
    ? clipConcrete(art.body, 260)
    : clipConcrete(block.conclusion, 220);
  const why = clipConcrete(art?.whyItMatters || block.whyItMatters, 160);
  return [
    `«${block.themeLabel}»`,
    allegation ? `Суть сигнала: ${allegation}` : null,
    why ? `Зачем это важно: ${why}` : null,
    domains ? `Где видно: ${domains}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function matrixFromBlock(block: ComposedThemeBlock): string {
  const art = block.articles[0];
  const domains = block.articles.map((a) => a.domain).slice(0, 2).join(", ");
  const signal = art
    ? clipConcrete(art.body, 200)
    : clipConcrete(block.conclusion, 180);
  return [
    `«${block.themeLabel}»`,
    signal ? `Сигнал: ${signal}` : null,
    domains ? `Источники в матрице: ${domains}.` : null,
    "Действие матрицы: сверить первичные документы и статус в тематическом резюме.",
  ]
    .filter(Boolean)
    .join("\n");
}

function surfaceAnglesFromBlock(block: ComposedThemeBlock): MaterialDisclosure["surfaceAngles"] {
  // No concrete domains here: SERP/images slides are page-scoped and QA
  // rejects domains that are not on that slide's evidenceRefs.
  const theme = block.themeLabel;
  return {
    serp: `В поисковой выдаче по теме «${theme}» видны релевантные результаты; полный разбор — в региональном резюме.`,
    images: `В блоке изображений по теме «${theme}» показаны визуальные материалы, связанные с сюжетом; смысл риска раскрыт в тематическом резюме, не в подписи к картинке.`,
    suggestions: `Подсказки поиска по теме «${theme}» отражают, как запрос формулируют пользователи; содержательный разбор публикаций — в резюме по региону.`,
  };
}

function pickFullOwner(finding: Finding): MaterialDisclosure["fullOwnerFragment"] {
  const regions = (finding.regions ?? []).map((r) => r.toUpperCase());
  const hasRu = regions.some((r) => r === "RU");
  const hasIntl = regions.some((r) => r === "UAE" || r === "INTERNATIONAL" || r === "GLOBAL");
  // Prefer RU when present. Prior logic sent any INTERNATIONAL tag to UAE_SUMMARY,
  // which emptied the Russia résumé of full theme cards on multi-region findings
  // (live Deripaska: RU summary had only uncategorized/likely boilerplate).
  if (hasRu) return "RU_SUMMARY";
  if (hasIntl) return "UAE_SUMMARY";
  return "RU_SUMMARY";
}

function blockForFinding(
  finding: Finding,
  summary: ComposedClientSummary
): ComposedThemeBlock | null {
  const themeId = resolveThemeRef(finding.theme).themeId;
  const all = [...summary.mediaThemeBlocks, ...summary.databaseThemeBlocks];
  return all.find((b) => b.themeId === themeId) ?? null;
}

/**
 * Build disclosure plan from composed summary + findings.
 * Each finding with a theme block gets exactly one fullOwnerFragment.
 */
export function buildCrossSlideDisclosurePlan(input: {
  caseId: string;
  datasetId: string;
  composed: ComposedClientSummary;
  findings: Finding[];
}): CrossSlideDisclosurePlan {
  const materials: MaterialDisclosure[] = [];
  const seenFindings = new Set<string>();

  for (const finding of input.findings) {
    if (finding.subjectMatch !== "SUBJECT_MATCH" && finding.subjectMatch !== "LIKELY_SUBJECT") {
      continue;
    }
    if (seenFindings.has(finding.findingId)) continue;
    const block = blockForFinding(finding, input.composed);
    if (!block) continue;
    seenFindings.add(finding.findingId);
    const fullText = themeBlockToClaimText(block);
    materials.push({
      findingId: finding.findingId,
      themeId: block.themeId,
      themeLabel: block.themeLabel,
      evidenceRefs:
        finding.evidenceRefs.length > 0 ? finding.evidenceRefs : block.evidenceRefs,
      fullOwnerFragment: pickFullOwner(finding),
      fullText,
      briefText: briefFromBlock(block),
      matrixText: matrixFromBlock(block),
      surfaceAngles: surfaceAnglesFromBlock(block),
    });
  }

  const withoutFull = materials.filter((m) => !m.fullText.trim()).length;
  const ownerCounts = new Map<string, number>();
  for (const m of materials) {
    ownerCounts.set(m.findingId, (ownerCounts.get(m.findingId) ?? 0) + 1);
  }
  const multiOwner = [...ownerCounts.values()].filter((n) => n > 1).length;

  return {
    schemaVersion: CROSS_SLIDE_DISCLOSURE_PLAN_VERSION,
    caseId: input.caseId,
    datasetId: input.datasetId,
    generatedAt: new Date().toISOString(),
    materials,
    gates: {
      MATERIALS_WITHOUT_FULL_DISCLOSURE: withoutFull,
      MATERIALS_WITH_MULTIPLE_FULL_OWNERS: multiOwner,
      CROSS_SLIDE_DUPLICATE_SENTENCES: 0,
    },
  };
}

export function assertDisclosurePlanGatesPass(plan: CrossSlideDisclosurePlan): void {
  if (plan.gates.MATERIALS_WITHOUT_FULL_DISCLOSURE !== 0) {
    throw new Error(
      `MATERIALS_WITHOUT_FULL_DISCLOSURE=${plan.gates.MATERIALS_WITHOUT_FULL_DISCLOSURE}`
    );
  }
  if (plan.gates.MATERIALS_WITH_MULTIPLE_FULL_OWNERS !== 0) {
    throw new Error(
      `MATERIALS_WITH_MULTIPLE_FULL_OWNERS=${plan.gates.MATERIALS_WITH_MULTIPLE_FULL_OWNERS}`
    );
  }
}

/** Look up material disclosure by finding id. */
export function disclosureForFinding(
  plan: CrossSlideDisclosurePlan | null | undefined,
  findingId: string
): MaterialDisclosure | null {
  if (!plan) return null;
  return plan.materials.find((m) => m.findingId === findingId) ?? null;
}
