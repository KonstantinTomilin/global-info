/**
 * Immutable physical page registry for CEO demo — first 36 ORION reference slides.
 * Page numbers never shift when data is missing.
 */

export type CeoSlideTemplate =
  | "ceo_cover"
  | "ceo_toc"
  | "ceo_executive"
  | "ceo_executive_dashboard"
  | "ceo_kpi_cards"
  | "ceo_region_divider"
  | "ceo_serp_matrix"
  | "ceo_serp_evidence"
  | "ceo_autocomplete"
  | "ceo_media_grid"
  | "ceo_knowledge_panel"
  | "ceo_status_table"
  | "ceo_compliance_profile";

export type CeoRegion = "GLOBAL" | "RU" | "UAE" | "COMPLIANCE";
export type CeoFallbackMode = "status_card" | "deterministic";

export type CeoRequiredMetric =
  | "executive_summary"
  | "subject_dashboard"
  | "consolidated_risk"
  | "ru_audit_summary"
  | "ru_search_kpi"
  | "ru_serp_matrix"
  | "uae_audit_summary"
  | "uae_search_kpi"
  | "uae_serp_matrix"
  | "wikipedia_status"
  | "compliance_dow_jones"
  | "compliance_lexis";

export type CeoRequiredAssetKind =
  | "synthetic_serp"
  | "live_serp"
  | "captured_serp"
  | "image_grid"
  | "knowledge_panel"
  | "lexis_visual_page"
  | "autocomplete"
  | "related_queries";

export type CeoFirst36SlideEntry = {
  referencePage: number;
  sectionKey: string;
  title: string;
  template: CeoSlideTemplate;
  region: CeoRegion;
  requiredMetrics: CeoRequiredMetric[];
  requiredAssetKinds: CeoRequiredAssetKind[];
  assetSlotIndex?: number;
  fallbackMode: CeoFallbackMode;
};

export const CEO_FIRST_36_SLIDE_COUNT = 36;

export const ORION_FIRST_36_SLIDE_REGISTRY_V1: readonly CeoFirst36SlideEntry[] = [
  { referencePage: 1, sectionKey: "ceo_cover", title: "ORION Digital Profile", template: "ceo_cover", region: "GLOBAL", requiredMetrics: [], requiredAssetKinds: [], fallbackMode: "deterministic" },
  { referencePage: 2, sectionKey: "ceo_global_toc", title: "Содержание", template: "ceo_toc", region: "GLOBAL", requiredMetrics: [], requiredAssetKinds: [], fallbackMode: "deterministic" },
  { referencePage: 3, sectionKey: "ceo_executive_resume", title: "Резюме", template: "ceo_executive", region: "GLOBAL", requiredMetrics: ["executive_summary"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 4, sectionKey: "ceo_subject_dashboard", title: "Цифровой профиль субъекта", template: "ceo_executive_dashboard", region: "GLOBAL", requiredMetrics: ["subject_dashboard"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 5, sectionKey: "ceo_consolidated_risk", title: "Сводка рисков цифрового профиля", template: "ceo_kpi_cards", region: "GLOBAL", requiredMetrics: ["consolidated_risk"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 6, sectionKey: "ru_divider", title: "Россия: цифровой профиль", template: "ceo_region_divider", region: "RU", requiredMetrics: [], requiredAssetKinds: [], fallbackMode: "deterministic" },
  { referencePage: 7, sectionKey: "ru_audit_summary", title: "Россия — резюме аудита", template: "ceo_kpi_cards", region: "RU", requiredMetrics: ["ru_audit_summary"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 8, sectionKey: "ru_search_kpi", title: "Россия — сводка поисковой выдачи", template: "ceo_kpi_cards", region: "RU", requiredMetrics: ["ru_search_kpi"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 9, sectionKey: "ru_serp_matrix", title: "Россия — матрица TOP-20", template: "ceo_serp_matrix", region: "RU", requiredMetrics: ["ru_serp_matrix"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 10, sectionKey: "ru_serp_evidence", title: "Россия — снимок выдачи", template: "ceo_serp_evidence", region: "RU", requiredMetrics: [], requiredAssetKinds: ["synthetic_serp", "live_serp", "captured_serp"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 11, sectionKey: "ru_autocomplete_1", title: "Россия — подсказки Google (1/2)", template: "ceo_autocomplete", region: "RU", requiredMetrics: [], requiredAssetKinds: ["autocomplete"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 12, sectionKey: "ru_autocomplete_2", title: "Россия — подсказки Google (2/2)", template: "ceo_autocomplete", region: "RU", requiredMetrics: [], requiredAssetKinds: ["autocomplete"], assetSlotIndex: 1, fallbackMode: "status_card" },
  { referencePage: 13, sectionKey: "ru_wikipedia", title: "Россия — Википедия", template: "ceo_status_table", region: "RU", requiredMetrics: ["wikipedia_status"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 14, sectionKey: "ru_images_1", title: "Россия — изображения (1/4)", template: "ceo_media_grid", region: "RU", requiredMetrics: [], requiredAssetKinds: ["image_grid"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 15, sectionKey: "ru_images_2", title: "Россия — изображения (2/4)", template: "ceo_media_grid", region: "RU", requiredMetrics: [], requiredAssetKinds: ["image_grid"], assetSlotIndex: 1, fallbackMode: "status_card" },
  { referencePage: 16, sectionKey: "ru_images_3", title: "Россия — изображения (3/4)", template: "ceo_media_grid", region: "RU", requiredMetrics: [], requiredAssetKinds: ["image_grid"], assetSlotIndex: 2, fallbackMode: "status_card" },
  { referencePage: 17, sectionKey: "ru_images_4", title: "Россия — изображения (4/4)", template: "ceo_media_grid", region: "RU", requiredMetrics: [], requiredAssetKinds: ["image_grid"], assetSlotIndex: 3, fallbackMode: "status_card" },
  { referencePage: 18, sectionKey: "ru_knowledge_1", title: "Россия — блок знаний (1/2)", template: "ceo_knowledge_panel", region: "RU", requiredMetrics: [], requiredAssetKinds: ["knowledge_panel"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 19, sectionKey: "ru_knowledge_2", title: "Россия — блок знаний (2/2)", template: "ceo_knowledge_panel", region: "RU", requiredMetrics: [], requiredAssetKinds: ["knowledge_panel"], assetSlotIndex: 1, fallbackMode: "status_card" },
  { referencePage: 20, sectionKey: "ru_related_1", title: "Россия — связанные запросы (1/3)", template: "ceo_autocomplete", region: "RU", requiredMetrics: [], requiredAssetKinds: ["related_queries"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 21, sectionKey: "ru_related_2", title: "Россия — связанные запросы (2/3)", template: "ceo_autocomplete", region: "RU", requiredMetrics: [], requiredAssetKinds: ["related_queries"], assetSlotIndex: 1, fallbackMode: "status_card" },
  { referencePage: 22, sectionKey: "ru_related_3", title: "Россия — связанные запросы (3/3)", template: "ceo_autocomplete", region: "RU", requiredMetrics: [], requiredAssetKinds: ["related_queries"], assetSlotIndex: 2, fallbackMode: "status_card" },
  { referencePage: 23, sectionKey: "uae_divider", title: "ОАЭ: цифровой профиль", template: "ceo_region_divider", region: "UAE", requiredMetrics: [], requiredAssetKinds: [], fallbackMode: "deterministic" },
  { referencePage: 24, sectionKey: "uae_audit_summary", title: "ОАЭ — резюме аудита", template: "ceo_kpi_cards", region: "UAE", requiredMetrics: ["uae_audit_summary"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 25, sectionKey: "uae_search_kpi", title: "ОАЭ — сводка поисковой выдачи", template: "ceo_kpi_cards", region: "UAE", requiredMetrics: ["uae_search_kpi"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 26, sectionKey: "uae_serp_matrix", title: "ОАЭ — матрица TOP-20", template: "ceo_serp_matrix", region: "UAE", requiredMetrics: ["uae_serp_matrix"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 27, sectionKey: "uae_serp_evidence", title: "ОАЭ — снимок выдачи", template: "ceo_serp_evidence", region: "UAE", requiredMetrics: [], requiredAssetKinds: ["synthetic_serp", "live_serp", "captured_serp"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 28, sectionKey: "uae_autocomplete", title: "ОАЭ — подсказки Google", template: "ceo_autocomplete", region: "UAE", requiredMetrics: [], requiredAssetKinds: ["autocomplete"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 29, sectionKey: "uae_wikipedia", title: "ОАЭ — Википедия", template: "ceo_status_table", region: "UAE", requiredMetrics: ["wikipedia_status"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 30, sectionKey: "uae_images", title: "ОАЭ — изображения", template: "ceo_media_grid", region: "UAE", requiredMetrics: [], requiredAssetKinds: ["image_grid"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 31, sectionKey: "uae_knowledge", title: "ОАЭ — блок знаний", template: "ceo_knowledge_panel", region: "UAE", requiredMetrics: [], requiredAssetKinds: ["knowledge_panel"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 32, sectionKey: "uae_related", title: "ОАЭ — связанные запросы", template: "ceo_autocomplete", region: "UAE", requiredMetrics: [], requiredAssetKinds: ["related_queries"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 33, sectionKey: "compliance_divider", title: "Международные базы данных", template: "ceo_region_divider", region: "COMPLIANCE", requiredMetrics: [], requiredAssetKinds: [], fallbackMode: "deterministic" },
  { referencePage: 34, sectionKey: "compliance_dow_jones", title: "Dow Jones — обзор профиля", template: "ceo_compliance_profile", region: "COMPLIANCE", requiredMetrics: ["compliance_dow_jones"], requiredAssetKinds: [], fallbackMode: "status_card" },
  { referencePage: 35, sectionKey: "compliance_lexis_1", title: "LexisNexis — обзор (1/2)", template: "ceo_compliance_profile", region: "COMPLIANCE", requiredMetrics: ["compliance_lexis"], requiredAssetKinds: ["lexis_visual_page"], assetSlotIndex: 0, fallbackMode: "status_card" },
  { referencePage: 36, sectionKey: "compliance_lexis_2", title: "LexisNexis — обзор (2/2)", template: "ceo_compliance_profile", region: "COMPLIANCE", requiredMetrics: ["compliance_lexis"], requiredAssetKinds: ["lexis_visual_page"], assetSlotIndex: 1, fallbackMode: "status_card" },
] as const;

export function getCeoSlideByPage(page: number): CeoFirst36SlideEntry | undefined {
  return ORION_FIRST_36_SLIDE_REGISTRY_V1.find((e) => e.referencePage === page);
}
