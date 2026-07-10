/**
 * Compose exactly 36 CEO demo slides — recovery: client labels, entity filter, no status leaks.
 */

import type { ReportAssetV1 } from "../../orion-report-spec/asset-builder";
import type { OrionGoldenDeckManifest, OrionGoldenDeckSlide } from "../composer/orion-deck-composer";
import {
  adverseClassificationLabel,
  complianceClientLabel,
  coverageClientLabel,
  profileClientLabel,
  wikiClientLabel,
} from "./ceo-client-labels";
import { assetByRegion } from "./ceo-entity-filter";
import { CEO_SYNTHETIC_SERP_CAPTION } from "./ceo-demo-mode";
import {
  CEO_FIRST_36_SLIDE_COUNT,
  ORION_FIRST_36_SLIDE_REGISTRY_V1,
  type CeoFirst36SlideEntry,
} from "./orion-first-36-slide-registry.v1";
import type { MetricRegistry } from "./report-metric-registry";
import { formatPctLabel } from "./report-metric-registry";
import type { ReportEvidenceSnapshot } from "./report-evidence-snapshot";

export type CeoDeckContext = {
  subjectName: string;
  reportRunId: string;
  snapshot: ReportEvidenceSnapshot;
  metrics: MetricRegistry;
  assets: ReportAssetV1[];
  reportDateLabel: string;
};

function serpAssets(region: "RU" | "UAE", assets: ReportAssetV1[]): ReportAssetV1[] {
  return assets.filter(
    (a) =>
      a.status === "ready" &&
      (a.kind === "synthetic_serp" || a.kind === "live_serp" || a.kind === "captured_serp") &&
      a.region === region &&
      Boolean(a.imageData)
  );
}

function surfaceItems(
  snapshot: ReportEvidenceSnapshot,
  region: "RU" | "UAE",
  surfaceMatch: RegExp,
  pageIndex: number,
  perPage: number
): string[] {
  const items = snapshot.surfaces.filter(
    (s) => s.region === region && surfaceMatch.test(s.surfaceType)
  );
  const start = pageIndex * perPage;
  return items
    .slice(start, start + perPage)
    .map((s) => String(s.query || s.title || "").trim())
    .filter((q) => q.length > 1);
}

export function buildExecutiveNarrative(ctx: CeoDeckContext): string {
  const m = ctx.metrics;
  const lines: string[] = [
    `Представлен предварительный аудит цифрового профиля ${ctx.subjectName}.`,
    `По результатам наблюдений в российском сегменте зафиксировано ${m.ru.observedPositions} позиций в выдаче, в международном (ОАЭ) — ${m.uae.observedPositions}.`,
  ];
  if (m.adverseObservedTotal > 0) {
    lines.push(
      `Выявлено ${m.adverseObservedTotal} потенциально нежелательных сигналов; подтверждённые риски требуют отдельной верификации.`
    );
  } else {
    lines.push("Существенных подтверждённых негативных публикаций в текущей выборке не зафиксировано.");
  }
  if (m.caveats.length > 0) {
    lines.push(m.caveats[0]);
  }
  return lines.join(" ");
}

function matrixRowLabel(
  row: MetricRegistry["ru"]["matrixRows"][number]
): string {
  const cls = adverseClassificationLabel(row.adverse);
  return `${row.query} | ${row.engine} | ${row.rank} | ${row.domain} | ${cls} | ${row.title.slice(0, 50)}`;
}

function buildSlideContent(
  entry: CeoFirst36SlideEntry,
  ctx: CeoDeckContext
): {
  title: string;
  narrative?: string;
  bullets?: string[];
  assetRefs?: string[];
  readiness?: "ready" | "blocked";
} {
  const m = ctx.metrics;

  switch (entry.template) {
    case "ceo_cover":
      return {
        title: "ORION Digital Profile",
        narrative: ctx.subjectName,
        bullets: ["Предварительный аудит цифрового профиля", ctx.reportDateLabel],
        readiness: "ready",
      };
    case "ceo_toc":
      return {
        title: "Содержание",
        bullets: ORION_FIRST_36_SLIDE_REGISTRY_V1.filter((e) => e.referencePage > 2).map(
          (e) => `${e.referencePage}. ${e.title}`
        ),
        readiness: "ready",
      };
    case "ceo_executive":
      return {
        title: entry.title,
        narrative: buildExecutiveNarrative(ctx),
        bullets: m.caveats
          .slice(0, 3)
          .filter((c) => !/RUN_SCOPED|LEGACY|reportRunId/i.test(c)),
        readiness: "ready",
      };
    case "ceo_executive_dashboard":
      return {
        title: entry.title,
        bullets: [
          `Россия — ${profileClientLabel(m.ru.profileLabel)} · наблюдений ${m.ru.observedPositions}`,
          `ОАЭ — ${profileClientLabel(m.uae.profileLabel)} · наблюдений ${m.uae.observedPositions}`,
          `Покрытие выборки: ${coverageClientLabel(m.coveragePct, m.dataMode)}`,
          `Википедия: ${wikiClientLabel(m.wikiStatus)}`,
          `Нежелательных сигналов: ${m.adverseObservedTotal}`,
        ],
        readiness: "ready",
      };
    case "ceo_kpi_cards": {
      const reg = entry.region === "RU" ? m.ru : entry.region === "UAE" ? m.uae : null;
      if (!reg && entry.sectionKey === "ceo_consolidated_risk") {
        return {
          title: entry.title,
          bullets: [
            `Сводный риск: нежелательных ${m.adverseObservedTotal}`,
            `Россия: ${m.ru.adverseObserved} (${formatPctLabel(m.ru.adversePct, m.dataMode)})`,
            `ОАЭ: ${m.uae.adverseObserved} (${formatPctLabel(m.uae.adversePct, m.dataMode)})`,
            `Покрытие: ${coverageClientLabel(m.coveragePct, m.dataMode)}`,
          ],
          readiness: "ready",
        };
      }
      if (!reg) return { title: entry.title, bullets: [], readiness: "blocked" };
      return {
        title: entry.title,
        bullets: [
          `Наблюдений: ${reg.observedPositions} из ${reg.expectedPositions}`,
          `Покрытие: ${formatPctLabel(reg.coveragePct, m.dataMode)}`,
          `Нежелательных сигналов: ${reg.adverseObserved}`,
          `Оценка профиля: ${profileClientLabel(reg.profileLabel)}`,
        ],
        readiness: "ready",
      };
    }
    case "ceo_region_divider":
      return { title: entry.title, readiness: "ready" };
    case "ceo_serp_matrix": {
      const reg = entry.region === "RU" ? m.ru : m.uae;
      const rows = reg.matrixRows;
      if (rows.length === 0) {
        return { title: entry.title, bullets: [], readiness: "blocked" };
      }
      return {
        title: entry.title,
        bullets: ["Запрос | Поисковик | Позиция | Домен | Классификация | Заголовок", ...rows.map(matrixRowLabel)],
        readiness: "ready",
      };
    }
    case "ceo_serp_evidence": {
      const serp = serpAssets(entry.region as "RU" | "UAE", ctx.assets);
      const asset = serp[entry.assetSlotIndex ?? 0];
      if (!asset?.imageData) {
        return { title: entry.title, bullets: [], readiness: "blocked" };
      }
      return {
        title: asset.title || entry.title,
        bullets: [asset.caption ?? CEO_SYNTHETIC_SERP_CAPTION],
        assetRefs: [asset.assetRef],
        readiness: "ready",
      };
    }
    case "ceo_autocomplete": {
      const isRelated = entry.sectionKey.includes("related");
      const perPage = isRelated ? 6 : 8;
      const bullets = surfaceItems(
        ctx.snapshot,
        entry.region as "RU" | "UAE",
        isRelated ? /RELATED/i : /SUGGESTION|AUTOCOMPLETE/i,
        entry.assetSlotIndex ?? 0,
        perPage
      );
      if (bullets.length === 0) {
        return { title: entry.title, bullets: [], readiness: "blocked" };
      }
      return { title: entry.title, bullets, readiness: "ready" };
    }
    case "ceo_status_table":
      return {
        title: entry.title,
        bullets: [wikiClientLabel(m.wikiStatus)],
        readiness: "ready",
      };
    case "ceo_media_grid": {
      const imgs = assetByRegion(ctx.assets, entry.region as "RU" | "UAE", "image_grid").filter(
        (a) => a.imageData
      );
      const slot = entry.assetSlotIndex ?? 0;
      const chunk = imgs.slice(slot * 6, slot * 6 + 6);
      if (chunk.length < 3) {
        return { title: entry.title, bullets: [], readiness: "blocked" };
      }
      return {
        title: entry.title,
        assetRefs: chunk.map((a) => a.assetRef),
        bullets: chunk.map((a) => (a.caption ?? a.title).slice(0, 80)),
        readiness: "ready",
      };
    }
    case "ceo_knowledge_panel": {
      const kg = assetByRegion(ctx.assets, entry.region as "RU" | "UAE", "knowledge_panel");
      const asset = kg[entry.assetSlotIndex ?? 0];
      if (!asset?.imageData) {
        return { title: entry.title, bullets: [], readiness: "blocked" };
      }
      return {
        title: entry.title,
        assetRefs: [asset.assetRef],
        bullets: [(asset.caption ?? asset.title).slice(0, 120)],
        readiness: "ready",
      };
    }
    case "ceo_compliance_profile": {
      if (entry.sectionKey.includes("dow_jones")) {
        const label = complianceClientLabel(m.compliance.dowJones);
        const djAssets = ctx.assets.filter(
          (a) =>
            a.status === "ready" &&
            a.imageData &&
            (a.kind === "lexis_visual_page" || /dow|dj/i.test(a.assetRef + a.title))
        );
        const asset = djAssets[0];
        if (asset) {
          return {
            title: entry.title,
            assetRefs: [asset.assetRef],
            bullets: [label],
            readiness: "ready",
          };
        }
        return {
          title: entry.title,
          bullets: [label],
          readiness: "blocked",
        };
      }
      const lexis = ctx.assets.filter(
        (a) => a.kind === "lexis_visual_page" && a.status === "ready" && a.imageData
      );
      const asset = lexis[entry.assetSlotIndex ?? 0];
      if (asset) {
        return {
          title: entry.title,
          assetRefs: [asset.assetRef],
          bullets: [complianceClientLabel(m.compliance.lexis)],
          readiness: "ready",
        };
      }
      return {
        title: entry.title,
        bullets: [complianceClientLabel(m.compliance.lexis)],
        readiness: "blocked",
      };
    }
    default:
      return { title: entry.title, bullets: [], readiness: "blocked" };
  }
}

export function composeOrionCeoFirst36Deck(ctx: CeoDeckContext): OrionGoldenDeckManifest {
  const finalSlides: OrionGoldenDeckSlide[] = [];

  for (const entry of ORION_FIRST_36_SLIDE_REGISTRY_V1) {
    const content = buildSlideContent(entry, ctx);
    finalSlides.push({
      slideKey: `ceo-p${entry.referencePage}-${entry.sectionKey}`,
      sectionKey: entry.sectionKey,
      template: entry.template,
      title: content.title.slice(0, 70),
      pageNumber: entry.referencePage,
      narrative: content.narrative?.slice(0, 420),
      bullets: content.bullets?.slice(0, 10).map((b) => b.slice(0, 130)),
      assetRefs: content.assetRefs,
        ceoMeta: {
        referencePage: entry.referencePage,
        region: entry.region,
        readiness: content.readiness,
        reportDateLabel: ctx.reportDateLabel,
      },
    });
  }

  if (finalSlides.length !== CEO_FIRST_36_SLIDE_COUNT) {
    throw new Error(`CEO deck must have ${CEO_FIRST_36_SLIDE_COUNT} slides, got ${finalSlides.length}`);
  }

  return {
    version: "r10-orion-golden-deck-manifest-v1",
    slideCount: finalSlides.length,
    finalSlides,
    sectionManifests: [
      {
        sectionKey: "ceo_first_36",
        slideCount: finalSlides.length,
        slides: finalSlides,
      },
    ],
    toc: ORION_FIRST_36_SLIDE_REGISTRY_V1.map((e) => ({
      title: e.title,
      pageNumber: e.referencePage,
    })),
    pageNumberMap: Object.fromEntries(finalSlides.map((s) => [s.slideKey, s.pageNumber])),
  };
}
