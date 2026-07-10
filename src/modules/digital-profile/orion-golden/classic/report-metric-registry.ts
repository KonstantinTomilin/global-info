/**
 * Single MetricRegistry for CEO demo — all slides read KPIs from here only.
 */

import type { ReportEvidenceSnapshot, SnapshotObservation } from "./report-evidence-snapshot";

export type RegionMetrics = {
  region: "RU" | "UAE";
  observedPositions: number;
  expectedPositions: number;
  coveragePct: number | null;
  adverseObserved: number;
  adversePct: number | null;
  suggestionsObserved: number;
  matrixRows: Array<{
    query: string;
    engine: string;
    rank: number;
    url: string;
    title: string;
    domain: string;
    adverse: boolean;
    evidenceRef: string;
  }>;
  unrankedCount: number;
  profileLabel: string | null;
};

export type MetricRegistry = {
  dataMode: ReportEvidenceSnapshot["dataMode"];
  coverageStatus: ReportEvidenceSnapshot["coverage"]["status"];
  coveragePct: number | null;
  adverseObservedTotal: number;
  adversePctTotal: number | null;
  ru: RegionMetrics;
  uae: RegionMetrics;
  wikiStatus: ReportEvidenceSnapshot["wikiStatus"];
  compliance: {
    dowJones: "VERIFIED_HIT" | "POSSIBLE_MATCH" | "NO_HIT" | "NOT_CHECKED" | "PROVIDER_UNAVAILABLE";
    lexis: "VERIFIED_HIT" | "POSSIBLE_MATCH" | "NO_HIT" | "NOT_CHECKED" | "PROVIDER_UNAVAILABLE";
    worldCheck: "VERIFIED_HIT" | "POSSIBLE_MATCH" | "NO_HIT" | "NOT_CHECKED" | "PROVIDER_UNAVAILABLE";
  };
  caveats: string[];
};

const ADVERSE_RE =
  /санкц|sanction|арест|arrest|мошен|fraud|корруп|corrupt|уголов|criminal|компромат|pep|rupep|offshore|офшор|adverse/i;

function isAdverse(obs: SnapshotObservation): boolean {
  const blob = `${obs.title ?? ""} ${obs.snippet ?? ""} ${obs.url} ${obs.domain ?? ""}`;
  return ADVERSE_RE.test(blob);
}

function buildRegionMetrics(
  snapshot: ReportEvidenceSnapshot,
  region: "RU" | "UAE"
): RegionMetrics {
  const organic = snapshot.observations.filter(
    (o) => o.surface === "organic" && o.region === region && o.rank > 0
  );
  const unranked = snapshot.observations.filter(
    (o) => o.surface === "organic" && o.region === region && o.rank <= 0
  );
  const adverse = organic.filter(isAdverse);
  const runScoped = snapshot.dataMode === "RUN_SCOPED";
  const coveragePct =
    runScoped && snapshot.coverage.pct != null ? snapshot.coverage.pct : null;
  const adversePct =
    runScoped && organic.length > 0
      ? Math.round((adverse.length / organic.length) * 100)
      : null;

  let profileLabel: string | null = null;
  if (!runScoped || coveragePct == null || coveragePct < 80) {
    profileLabel = null;
  } else if (adversePct != null && adversePct >= 25) {
    profileLabel = region === "UAE" ? "Крайне негативный" : "Нежелательный";
  } else if (adversePct != null && adversePct >= 10) {
    profileLabel = "Нежелательный";
  } else if (adversePct != null) {
    profileLabel = "Нейтральный";
  }

  const matrixRows = organic.slice(0, 20).map((o) => ({
    query: o.queryText,
    engine: o.engine,
    rank: o.rank,
    url: o.url,
    title: o.title ?? o.domain ?? o.url,
    domain: o.domain ?? "",
    adverse: isAdverse(o),
    evidenceRef: `serp_observation:${o.id}`,
  }));

  const suggestions = snapshot.surfaces.filter(
    (s) =>
      s.region === region &&
      (s.surfaceType.includes("SUGGESTION") || s.surfaceType.includes("AUTOCOMPLETE"))
  );

  return {
    region,
    observedPositions: organic.length,
    expectedPositions: Math.max(20, organic.length),
    coveragePct,
    adverseObserved: adverse.length,
    adversePct,
    suggestionsObserved: suggestions.length,
    matrixRows,
    unrankedCount: unranked.length,
    profileLabel,
  };
}

function complianceStatus(
  ctxProfiles: { provider?: string; status?: string }[],
  provider: string
): MetricRegistry["compliance"]["dowJones"] {
  const row = ctxProfiles.find((p) =>
    String(p.provider ?? "").toLowerCase().includes(provider.toLowerCase())
  );
  if (!row) return "NOT_CHECKED";
  const s = String(row.status ?? "").toUpperCase();
  if (s.includes("VERIFIED") || s.includes("CONFIRMED")) return "VERIFIED_HIT";
  if (s.includes("POSSIBLE") || s.includes("MATCH")) return "POSSIBLE_MATCH";
  if (s.includes("UNAVAILABLE")) return "PROVIDER_UNAVAILABLE";
  if (s.includes("NO") || s.includes("CLEAR")) return "NO_HIT";
  return "POSSIBLE_MATCH";
}

export function buildMetricRegistry(
  snapshot: ReportEvidenceSnapshot,
  databaseProfiles: Array<{ provider?: string; status?: string }> = []
): MetricRegistry {
  const ru = buildRegionMetrics(snapshot, "RU");
  const uae = buildRegionMetrics(snapshot, "UAE");
  const caveats: string[] = [...snapshot.warnings];

  if (snapshot.dataMode !== "RUN_SCOPED") {
    caveats.push("Предварительная выборка; доля не рассчитывается");
  } else if (snapshot.coverage.status === "INCOMPLETE") {
    caveats.push(`Покрытие выборки ${snapshot.coverage.pct ?? 0}% — доли ориентировочные`);
  }

  const totalOrganic =
    snapshot.observations.filter((o) => o.surface === "organic" && o.rank > 0).length;
  const totalAdverse = snapshot.observations.filter(
    (o) => o.surface === "organic" && o.rank > 0 && isAdverse(o)
  ).length;

  return {
    dataMode: snapshot.dataMode,
    coverageStatus: snapshot.coverage.status,
    coveragePct: snapshot.dataMode === "RUN_SCOPED" ? snapshot.coverage.pct : null,
    adverseObservedTotal: totalAdverse,
    adversePctTotal:
      snapshot.dataMode === "RUN_SCOPED" && totalOrganic > 0
        ? Math.round((totalAdverse / totalOrganic) * 100)
        : null,
    ru,
    uae,
    wikiStatus: snapshot.wikiStatus,
    compliance: {
      dowJones: complianceStatus(databaseProfiles, "dow"),
      lexis: complianceStatus(databaseProfiles, "lexis"),
      worldCheck: complianceStatus(databaseProfiles, "world"),
    },
    caveats,
  };
}

export function formatPctLabel(pct: number | null, dataMode: ReportEvidenceSnapshot["dataMode"]): string {
  if (dataMode !== "RUN_SCOPED" || pct == null) {
    return "предварительная выборка; доля не рассчитывается";
  }
  return `${pct}%`;
}
