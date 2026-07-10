/**
 * Client-facing RU labels for CEO first-36 — no raw enums or internal IDs.
 */

import type { MetricRegistry } from "./report-metric-registry";
import type { ReportEvidenceSnapshot } from "./report-evidence-snapshot";

export type ComplianceStatus = MetricRegistry["compliance"]["dowJones"];

export function wikiClientLabel(
  status: ReportEvidenceSnapshot["wikiStatus"]
): string {
  switch (status) {
    case "EXACT_SUBJECT":
      return "Статья о персоне найдена";
    case "NAMESAKE_OR_OTHER_ENTITY":
      return "Найдена страница другого субъекта или рода — не профиль персоны";
    case "RELATED_ENTITY":
      return "Найдена связанная сущность — требуется сверка";
    case "ABSENT":
      return "Статья о персоне отсутствует";
    default:
      return "Статус Википедии не подтверждён";
  }
}

export function complianceClientLabel(status: ComplianceStatus): string {
  switch (status) {
    case "VERIFIED_HIT":
      return "Подтверждённое совпадение — требуется сверка полного профиля";
    case "POSSIBLE_MATCH":
      return "Предварительное совпадение — не является подтверждённым риском";
    case "NO_HIT":
      return "Совпадений не обнаружено";
    case "NOT_CHECKED":
      return "Проверка не выполнялась";
    case "PROVIDER_UNAVAILABLE":
      return "Данные провайдера недоступны";
    default:
      return "Требуется проверка";
  }
}

export function coverageClientLabel(
  pct: number | null,
  dataMode: ReportEvidenceSnapshot["dataMode"]
): string {
  if (dataMode !== "RUN_SCOPED" || pct == null) {
    return "Предварительная выборка; доля не рассчитывается";
  }
  return `${pct}%`;
}

export function profileClientLabel(label: string | null): string {
  return label ?? "Оценка не рассчитывается";
}

export function adverseClassificationLabel(adverse: boolean): string {
  return adverse ? "Нежелательный" : "Нейтральный";
}

/** Hard-block patterns that must never appear in client-facing CEO copy. */
export const CEO_CLIENT_POLICY_BLOCK_RE =
  /\[DEMO\]|(?:^|\s)demo(?:\s|$)|fixture|placeholder|RUN_SCOPED|LEGACY_CASE_SCOPE|orion-r10-|NAMESAKE_OR_OTHER_ENTITY|POSSIBLE_MATCH|VERIFIED_HIT|NOT_CHECKED|PROVIDER_UNAVAILABLE|EXACT_SUBJECT|RELATED_ENTITY|UNVERIFIED|материал недоступен|Визуальный материал недоступен|Данные для этого слайда недоступны/i;

export function scanCeoClientTextLeaks(texts: string[]): string[] {
  const issues: string[] = [];
  for (const raw of texts) {
    const t = String(raw ?? "");
    if (!t.trim()) continue;
    if (CEO_CLIENT_POLICY_BLOCK_RE.test(t)) {
      issues.push(`client-leak:${t.slice(0, 60)}`);
    }
    if (/orion-r10-\d+/i.test(t)) issues.push(`run-id-leak:${t.slice(0, 40)}`);
  }
  return issues;
}
