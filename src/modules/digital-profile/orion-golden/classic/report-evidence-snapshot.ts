/**
 * Run-scoped evidence snapshot for CEO demo — SerpObservation first, legacy fallback marked.
 */

import { prisma } from "@/server/prisma/client";
import type { OrionRealCaseContext } from "../../orion-section-pipeline/real-case-data-adapter";

export type EvidenceDataMode = "RUN_SCOPED" | "LEGACY_CASE_SCOPE";
export type CoverageStatus = "COMPLETE" | "INCOMPLETE" | "EMPTY";

export type SnapshotObservation = {
  id: string;
  queryId: string;
  queryText: string;
  provider: string;
  engine: string;
  surface: string;
  region: string;
  language: string;
  rank: number;
  url: string;
  title: string | null;
  snippet: string | null;
  domain: string | null;
  providerStatus: string;
  capturedAt: string;
};

export type SnapshotSurfaceItem = {
  id: string;
  surfaceType: string;
  query: string;
  region: string;
  title: string | null;
  snippet: string | null;
  url: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  evidenceRef: string;
};

export type ReportEvidenceSnapshot = {
  reportRunId: string;
  caseId: string;
  dataMode: EvidenceDataMode;
  coverage: {
    status: CoverageStatus;
    pct: number | null;
    observedOrganic: number;
    expectedOrganic: number;
  };
  observations: SnapshotObservation[];
  surfaces: SnapshotSurfaceItem[];
  wikiStatus: "EXACT_SUBJECT" | "NAMESAKE_OR_OTHER_ENTITY" | "RELATED_ENTITY" | "ABSENT" | "UNVERIFIED";
  warnings: string[];
};

function regionOf(raw: string): string {
  const r = raw.toUpperCase().replace(/^INTERNATIONAL$/, "INTL");
  if (r === "AE") return "UAE";
  return r;
}

function inferWikiStatus(ctx: OrionRealCaseContext): ReportEvidenceSnapshot["wikiStatus"] {
  for (const w of ctx.wikiChecks) {
    const title = String(w.pageTitle ?? w.url ?? "").toLowerCase();
    if (/дворянск|род\)|family|dynasty/.test(title)) return "NAMESAKE_OR_OTHER_ENTITY";
    if (w.exists) return "EXACT_SUBJECT";
  }
  if (ctx.wikiChecks.length === 0) return "ABSENT";
  return "UNVERIFIED";
}

function mapSurfaces(ctx: OrionRealCaseContext): SnapshotSurfaceItem[] {
  return ctx.searchSurfaces.map((row) => {
    const rm = (row.rawMetadata && typeof row.rawMetadata === "object" ? row.rawMetadata : {}) as Record<
      string,
      unknown
    >;
    return {
      id: row.id,
      surfaceType: String(row.type ?? "ORGANIC_RESULT"),
      query: String(rm.query ?? rm.orionQuery ?? ""),
      region: regionOf(String(rm.orionRegion ?? rm.region ?? row.region ?? "RU")),
      title: row.title,
      snippet: row.snippet,
      url: row.url,
      imageUrl: row.imageUrl,
      thumbnailUrl: row.thumbnailUrl,
      evidenceRef: `surface:${row.id}`,
    };
  });
}

export async function buildReportEvidenceSnapshot(input: {
  caseId: string;
  reportRunId: string;
  ctx: OrionRealCaseContext;
}): Promise<ReportEvidenceSnapshot> {
  const warnings: string[] = [];
  const rows = await prisma.serpObservation.findMany({
    where: { auditRunId: input.reportRunId, caseId: input.caseId },
    orderBy: [{ queryId: "asc" }, { rank: "asc" }],
  });

  const observations: SnapshotObservation[] = rows.map((r) => ({
    id: r.id,
    queryId: r.queryId,
    queryText: r.queryText,
    provider: r.provider,
    engine: r.engine,
    surface: r.surface,
    region: regionOf(r.region),
    language: r.language,
    rank: r.rank,
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    domain: r.domain,
    providerStatus: r.providerStatus,
    capturedAt: r.capturedAt.toISOString(),
  }));

  const dataMode: EvidenceDataMode = observations.length > 0 ? "RUN_SCOPED" : "LEGACY_CASE_SCOPE";
  if (dataMode === "LEGACY_CASE_SCOPE") {
    warnings.push("LEGACY_CASE_SCOPE: SerpObservation для reportRunId отсутствуют — KPI не достоверны");
  }

  const organic = observations.filter((o) => o.surface === "organic" && o.rank > 0);
  const expectedOrganic = Math.max(organic.length, dataMode === "RUN_SCOPED" ? 20 : 0);
  const observedOrganic = organic.length;
  let coverageStatus: CoverageStatus = "EMPTY";
  let coveragePct: number | null = null;
  if (observedOrganic > 0) {
    coveragePct = Math.min(100, Math.round((observedOrganic / Math.max(expectedOrganic, 1)) * 100));
    coverageStatus = coveragePct >= 80 ? "COMPLETE" : "INCOMPLETE";
  }

  return {
    reportRunId: input.reportRunId,
    caseId: input.caseId,
    dataMode,
    coverage: {
      status: coverageStatus,
      pct: dataMode === "RUN_SCOPED" ? coveragePct : null,
      observedOrganic,
      expectedOrganic,
    },
    observations,
    surfaces: mapSurfaces(input.ctx),
    wikiStatus: inferWikiStatus(input.ctx),
    warnings,
  };
}
