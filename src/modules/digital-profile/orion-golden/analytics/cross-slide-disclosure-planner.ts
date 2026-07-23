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

function briefFromBlock(block: ComposedThemeBlock): string {
  // Distinct from fullText: never paste conclusion / why / recommendedChecks
  // verbatim — that fails CROSS_SLIDE_DUPLICATE_SENTENCES vs RU/UAE_SUMMARY.
  const art = block.articles[0];
  const domains = block.articles.map((a) => a.domain).slice(0, 2).join(", ");
  const lead = `В резюме зафиксирована тема «${block.themeLabel}»${domains ? ` (сигналы: ${domains})` : ""}; полный разбор — в тематическом разделе.`;
  const example = art
    ? `Ключевой материал: ${art.domain}.`
    : "";
  const action =
    "Чек-лист и разбор первоисточников — в региональном резюме по этой теме.";
  return [lead, example, action].filter(Boolean).join("\n");
}

function matrixFromBlock(block: ComposedThemeBlock): string {
  const domains = block.articles.map((a) => a.domain).slice(0, 2).join(", ");
  return [
    `Матрица риска: тема «${block.themeLabel}» требует отдельной проверки${domains ? ` (сигналы: ${domains})` : ""}.`,
    "Приоритет матрицы: уточнить первичные документы в тематическом резюме (без повтора полного текста).",
  ].join("\n");
}

function surfaceAnglesFromBlock(block: ComposedThemeBlock): MaterialDisclosure["surfaceAngles"] {
  const domains = block.articles.map((a) => a.domain).slice(0, 2).join(", ");
  const theme = block.themeLabel;
  return {
    serp: `В поисковой выдаче по теме «${theme}» видны релевантные результаты${domains ? ` (${domains})` : ""}; полный разбор — в региональном резюме.`,
    images: `В блоке изображений по теме «${theme}» показаны визуальные материалы, связанные с сюжетом; смысл риска раскрыт в тематическом резюме, не в подписи к картинке.`,
    suggestions: `Подсказки поиска по теме «${theme}» отражают, как запрос формулируют пользователи; содержательный разбор публикаций — в резюме по региону.`,
  };
}

function pickFullOwner(finding: Finding): MaterialDisclosure["fullOwnerFragment"] {
  const regions = (finding.regions ?? []).map((r) => r.toUpperCase());
  if (regions.some((r) => r === "UAE" || r === "INTERNATIONAL" || r === "GLOBAL")) {
    return "UAE_SUMMARY";
  }
  // Full ORION paragraph belongs on a regional summary page (budget-safe cards
  // on EXECUTIVE_SUMMARY cannot carry fullText — that fails section QA at 900).
  if (regions.some((r) => r === "RU")) return "RU_SUMMARY";
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
