/**
 * Compose exactly 36 CEO demo slides from immutable registry + snapshot/metrics/assets.
 */

import type { ReportAssetV1 } from "../../orion-report-spec/asset-builder";
import type { OrionGoldenDeckManifest, OrionGoldenDeckSlide } from "../composer/orion-deck-composer";
import {
  CEO_FIRST_36_SLIDE_COUNT,
  ORION_FIRST_36_SLIDE_REGISTRY_V1,
  type CeoFirst36SlideEntry,
} from "./orion-first-36-slide-registry.v1";
import { CEO_SYNTHETIC_SERP_CAPTION } from "./ceo-demo-mode";
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
      (a.region === region || (!a.region && (region === "RU" ? !/uae/i.test(a.assetRef) : /uae/i.test(a.assetRef))))
  );
}

function mediaAssets(
  region: "RU" | "UAE",
  kind: ReportAssetV1["kind"],
  assets: ReportAssetV1[]
): ReportAssetV1[] {
  return assets.filter(
    (a) =>
      a.status === "ready" &&
      a.kind === kind &&
      (a.region === region || (!a.region && (region === "RU" ? !/uae/i.test(a.assetRef) : /uae/i.test(a.assetRef))))
  );
}

function surfaceBullets(
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
  return items.slice(start, start + perPage).map((s) => s.title ?? s.query ?? s.url ?? "—");
}


function statusBullets(entry: CeoFirst36SlideEntry, ctx: CeoDeckContext): string[] {
  return [
    `Режим данных: ${ctx.snapshot.dataMode}`,
    `Покрытие: ${ctx.snapshot.coverage.status}${ctx.snapshot.coverage.pct != null ? ` (${ctx.snapshot.coverage.pct}%)` : ""}`,
    `Run: ${ctx.reportRunId.slice(0, 20)}…`,
    "Данные для этого слайда недоступны — показан статус вместо подстановки.",
  ];
}

function buildSlideContent(
  entry: CeoFirst36SlideEntry,
  ctx: CeoDeckContext
): { title: string; narrative?: string; bullets?: string[]; assetRefs?: string[] } {
  const m = ctx.metrics;
  const snap = ctx.snapshot;

  switch (entry.template) {
    case "ceo_cover":
      return {
        title: "ORION Digital Profile",
        narrative: ctx.subjectName,
        bullets: ["CEO Demo · первые 36 слайдов", ctx.reportDateLabel],
      };
    case "ceo_toc":
      return {
        title: "Содержание",
        bullets: ORION_FIRST_36_SLIDE_REGISTRY_V1.filter((e) => e.referencePage > 2).map(
          (e) => `${e.referencePage}. ${e.title}`
        ),
      };
    case "ceo_executive":
      return {
        title: entry.title,
        narrative: m.dataMode === "RUN_SCOPED"
          ? `Аудит цифрового профиля ${ctx.subjectName}. Данные привязаны к run ${ctx.reportRunId}.`
          : `Аудит цифрового профиля ${ctx.subjectName}. ${m.caveats[0] ?? "Предварительная выборка."}`,
        bullets: m.caveats.slice(0, 4),
      };
    case "ceo_executive_dashboard":
      return {
        title: entry.title,
        bullets: [
          `Россия: ${m.ru.profileLabel ?? "—"} · наблюдений ${m.ru.observedPositions}`,
          `ОАЭ: ${m.uae.profileLabel ?? "—"} · наблюдений ${m.uae.observedPositions}`,
          `Нежелательных сигналов: ${m.adverseObservedTotal}`,
          `Википедия: ${m.wikiStatus}`,
        ],
      };
    case "ceo_kpi_cards": {
      const reg = entry.region === "RU" ? m.ru : entry.region === "UAE" ? m.uae : null;
      if (!reg) {
        return {
          title: entry.title,
          bullets: [
            `RU adverse: ${m.ru.adverseObserved} (${formatPctLabel(m.ru.adversePct, m.dataMode)})`,
            `UAE adverse: ${m.uae.adverseObserved} (${formatPctLabel(m.uae.adversePct, m.dataMode)})`,
            `Coverage: ${formatPctLabel(m.coveragePct, m.dataMode)}`,
          ],
        };
      }
      return {
        title: entry.title,
        bullets: [
          `Наблюдений: ${reg.observedPositions} / ${reg.expectedPositions}`,
          `Покрытие: ${formatPctLabel(reg.coveragePct, m.dataMode)}`,
          `Нежелательных: ${reg.adverseObserved}${reg.adversePct != null ? ` (${reg.adversePct}%)` : ""}`,
          `Оценка: ${reg.profileLabel ?? "не рассчитывается"}`,
        ],
      };
    }
    case "ceo_region_divider":
      return { title: entry.title };
    case "ceo_serp_matrix": {
      const reg = entry.region === "RU" ? m.ru : m.uae;
      const rows = reg.matrixRows;
      if (rows.length === 0) {
        return { title: entry.title, bullets: statusBullets(entry, ctx) };
      }
      return {
        title: entry.title,
        bullets: rows.map(
          (r) =>
            `${r.adverse ? "[Н]" : "[·]"} #${r.rank} ${r.engine} · ${r.domain} — ${r.title.slice(0, 60)}`
        ),
      };
    }
    case "ceo_serp_evidence": {
      const serp = serpAssets(entry.region as "RU" | "UAE", ctx.assets);
      const asset = serp[entry.assetSlotIndex ?? 0];
      if (!asset) {
        return { title: entry.title, bullets: statusBullets(entry, ctx) };
      }
      return {
        title: asset.title || entry.title,
        bullets: [asset.caption ?? CEO_SYNTHETIC_SERP_CAPTION],
        assetRefs: [asset.assetRef],
      };
    }
    case "ceo_autocomplete": {
      const isRelated = entry.sectionKey.includes("related");
      const perPage = isRelated ? 7 : 8;
      const bullets = surfaceBullets(
        snap,
        entry.region as "RU" | "UAE",
        isRelated ? /RELATED/i : /SUGGESTION|AUTOCOMPLETE/i,
        entry.assetSlotIndex ?? 0,
        perPage
      );
      if (bullets.length === 0) {
        return { title: entry.title, bullets: statusBullets(entry, ctx) };
      }
      return { title: entry.title, bullets };
    }
    case "ceo_status_table":
      if (entry.region === "RU" || entry.region === "UAE") {
        const wiki =
          m.wikiStatus === "NAMESAKE_OR_OTHER_ENTITY"
            ? "Найдена страница другого субъекта / рода — не профиль персоны"
            : m.wikiStatus === "ABSENT"
              ? "Статья о персоне отсутствует"
              : m.wikiStatus;
        return {
          title: entry.title,
          bullets: [`Статус: ${wiki}`, `Режим: ${m.dataMode}`],
        };
      }
      return { title: entry.title, bullets: statusBullets(entry, ctx) };
    case "ceo_media_grid": {
      const imgs = mediaAssets(entry.region as "RU" | "UAE", "image_grid", ctx.assets);
      const slot = entry.assetSlotIndex ?? 0;
      const chunk = imgs.slice(slot * 6, slot * 6 + 6);
      if (chunk.length === 0) {
        return { title: entry.title, bullets: statusBullets(entry, ctx) };
      }
      return {
        title: entry.title,
        assetRefs: chunk.map((a) => a.assetRef),
        bullets: chunk.map((a) => a.caption ?? a.title).slice(0, 4),
      };
    }
    case "ceo_knowledge_panel": {
      const kg = mediaAssets(entry.region as "RU" | "UAE", "knowledge_panel", ctx.assets);
      const asset = kg[entry.assetSlotIndex ?? 0];
      if (!asset?.imageData) {
        return { title: entry.title, bullets: statusBullets(entry, ctx) };
      }
      return {
        title: entry.title,
        assetRefs: [asset.assetRef],
        bullets: [asset.caption ?? asset.title],
      };
    }
    case "ceo_compliance_profile": {
      if (entry.sectionKey.includes("dow_jones")) {
        const st = m.compliance.dowJones;
        return {
          title: entry.title,
          bullets: [
            `Статус: ${st}`,
            st === "VERIFIED_HIT"
              ? "Подтверждённое совпадение — требуется сверка полного профиля"
              : "Предварительный сигнал — не является подтверждённым риском",
          ],
        };
      }
      const lexis = ctx.assets.filter((a) => a.kind === "lexis_visual_page" && a.status === "ready");
      const asset = lexis[entry.assetSlotIndex ?? 0];
      if (asset?.imageData) {
        return {
          title: entry.title,
          assetRefs: [asset.assetRef],
          bullets: [`Статус: ${m.compliance.lexis}`],
        };
      }
      return {
        title: entry.title,
        bullets: [
          `Статус: ${m.compliance.lexis}`,
          "Визуальный профиль LexisNexis недоступен — показан статус провайдера",
        ],
      };
    }
    default:
      return { title: entry.title, bullets: statusBullets(entry, ctx) };
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
      bullets: content.bullets?.slice(0, 5).map((b) => b.slice(0, 130)),
      assetRefs: content.assetRefs,
      ceoMeta: {
        referencePage: entry.referencePage,
        region: entry.region,
        dataMode: ctx.snapshot.dataMode,
        reportRunId: ctx.reportRunId,
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
    pageNumberMap: Object.fromEntries(
      finalSlides.map((s) => [s.slideKey, s.pageNumber])
    ),
  };
}
