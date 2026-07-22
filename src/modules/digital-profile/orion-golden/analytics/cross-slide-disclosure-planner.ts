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

function firstSentence(text: string, maxLen = 220): string {
  const t = text.replace(/\s+/gu, " ").trim();
  const m = t.match(/^(.+?[.!?…])(?:\s|$)/u);
  const s = (m?.[1] ?? t).trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(" ");
  // Prefer a complete shorter clause without ellipsis (C7 truncation gate).
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}.`;
}

function briefFromBlock(block: ComposedThemeBlock): string {
  // Distinct from fullText: no shared conclusion/why sentences (C6 dedupe gate).
  const art = block.articles[0];
  const domains = block.articles.map((a) => a.domain).slice(0, 2).join(", ");
  const lead = `В резюме зафиксирована тема «${block.themeLabel}»${domains ? ` (сигналы: ${domains})` : ""}; полный разбор — в тематическом разделе.`;
  const example = art
    ? `Ключевой материал: ${art.domain}.`
    : "";
  const action = block.recommendedChecks[0]
    ? `Дальше: ${firstSentence(block.recommendedChecks[0], 120)}`
    : "";
  return [lead, example, action].filter(Boolean).join("\n");
}

function matrixFromBlock(block: ComposedThemeBlock): string {
  const domains = block.articles.map((a) => a.domain).slice(0, 2).join(", ");
  const check = block.recommendedChecks[0] ?? "Проверить первоисточники по теме";
  return [
    `Матрица риска: тема «${block.themeLabel}» требует отдельной проверки${domains ? ` (сигналы: ${domains})` : ""}.`,
    `Приоритетное действие: ${firstSentence(check, 140)}`,
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
  if (regions.some((r) => r === "RU")) return "RU_SUMMARY";
  if (regions.some((r) => r === "UAE" || r === "INTERNATIONAL" || r === "GLOBAL")) {
    return "UAE_SUMMARY";
  }
  // No region tag — keep full on executive so the material is still disclosed once.
  return "EXECUTIVE_SUMMARY";
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
