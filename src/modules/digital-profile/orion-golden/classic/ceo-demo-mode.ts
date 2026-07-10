/** CEO demo: fixed first-36 ORION slides, 16:10 renderer, run-scoped metrics. */

export function isCeoDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORION_CEO_DEMO_MODE === "1";
}

export const CEO_SYNTHETIC_SERP_CAPTION =
  "Синтетическая реконструкция по результатам API; не browser screenshot";

export const CEO_API_FOOTER_CAPTION =
  "Синтетический снимок на основе сохранённых результатов API";
