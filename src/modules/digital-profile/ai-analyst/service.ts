import { digitalProfileConfig } from "../config";
import type { AiAnalystNarrative, ReportJson } from "../types";
import { buildDeterministicAiAnalystNarrative } from "./deterministic-narrative";
import { buildAiAnalystEvidencePack } from "./evidence-pack";
import { generateOpenAiGpt55Narrative } from "./openai-gpt55-analyst";
import { validateAiAnalystNarrative } from "./schema";

export interface AiAnalystGenerationOutcome {
  narrative: AiAnalystNarrative;
  diagnostics: {
    enabled: boolean;
    provider: "openai" | "none";
    model: string;
    status: "ready" | "fallback" | "unavailable";
    reason?: string;
  };
}

export class AiAnalystUnavailableError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`AI analyst unavailable: ${reason}`);
    this.name = "AiAnalystUnavailableError";
    this.reason = reason;
  }
}

function fallbackReasonLabel(reason: string | undefined, lang: "ru" | "en"): string {
  if (!reason) return "";
  const low = reason.toLowerCase();
  if (low.includes("api_key")) return lang === "ru" ? "API key missing" : "API key missing";
  if (low.includes("timeout") || low.includes("abort"))
    return lang === "ru" ? "timeout" : "timeout";
  if (low.includes("schema") || low.includes("json"))
    return lang === "ru" ? "invalid model response" : "invalid model response";
  if (low.includes("http_401") || low.includes("http_403"))
    return lang === "ru" ? "API key missing" : "API key missing";
  if (low.includes("model"))
    return lang === "ru" ? "model unavailable" : "model unavailable";
  return lang === "ru" ? "provider unavailable" : "provider unavailable";
}

function refuseOrFallback(input: {
  pack: ReturnType<typeof buildAiAnalystEvidencePack>;
  lang: "ru" | "en";
  enabled: boolean;
  model: string;
  reason: string;
  /** When true and fallback allowed, diagnostics.status stays "fallback" (legacy). */
  softFallbackStatus?: "fallback" | "unavailable";
}): AiAnalystGenerationOutcome {
  const allow = digitalProfileConfig.orionV2AllowDeterministicFallback;
  const label = fallbackReasonLabel(input.reason, input.lang);
  if (!allow) {
    throw new AiAnalystUnavailableError(label || input.reason);
  }
  const soft = input.softFallbackStatus ?? "unavailable";
  return {
    narrative: buildDeterministicAiAnalystNarrative(input.pack, {
      status: "fallback",
      warnings: label ? [label] : [input.reason].filter(Boolean),
    }),
    diagnostics: {
      enabled: input.enabled,
      provider: input.enabled ? "openai" : "none",
      model: input.model,
      status: soft,
      reason: label || input.reason,
    },
  };
}

export async function generateAiAnalystNarrative(
  reportJson: ReportJson
): Promise<AiAnalystGenerationOutcome> {
  const lang = reportJson.reportLanguage === "en" ? "en" : "ru";
  const cfg = digitalProfileConfig.aiAnalyst;
  const pack = buildAiAnalystEvidencePack(reportJson, {
    maxInputItems: cfg.maxInputItems,
  });

  if (!cfg.enabled) {
    return refuseOrFallback({
      pack,
      lang,
      enabled: false,
      model: cfg.model,
      reason: "disabled by config",
      softFallbackStatus: "fallback",
    });
  }

  if (!cfg.model.trim()) {
    return refuseOrFallback({
      pack,
      lang,
      enabled: true,
      model: cfg.model,
      reason: "model_id_missing",
    });
  }

  const apiKey = cfg.openAiApiKey;
  if (!apiKey) {
    return refuseOrFallback({
      pack,
      lang,
      enabled: true,
      model: cfg.model,
      reason: "api_key_missing",
      softFallbackStatus: "fallback",
    });
  }

  try {
    const generated = await generateOpenAiGpt55Narrative(
      {
        apiKey,
        model: cfg.model,
        timeoutMs: cfg.timeoutMs,
        maxOutputTokens: cfg.maxOutputTokens,
      },
      pack
    );
    const validated = validateAiAnalystNarrative(generated);
    if (!validated.ok) {
      throw new Error(`schema_invalid:${validated.issues.join("|")}`);
    }
    const narrative: AiAnalystNarrative = {
      ...validated.value,
      status: "ready",
      generatedBy: "gpt-5.5",
      provider: "openai",
      language: lang,
      generatedAt: validated.value.generatedAt ?? new Date().toISOString(),
      meta: {
        ...validated.value.meta,
        evidenceItemsUsed: pack.meta.evidenceItemsUsed,
        truncatedInput: pack.meta.truncatedInput,
        warnings: [
          ...(validated.value.meta.warnings ?? []),
          ...pack.meta.warnings,
        ].slice(0, 20),
      },
    };
    return {
      narrative,
      diagnostics: {
        enabled: true,
        provider: "openai",
        model: cfg.model,
        status: "ready",
      },
    };
  } catch (error) {
    if (error instanceof AiAnalystUnavailableError) throw error;
    const reason = error instanceof Error ? error.message : "unknown";
    return refuseOrFallback({
      pack,
      lang,
      enabled: true,
      model: cfg.model,
      reason,
      softFallbackStatus: "fallback",
    });
  }
}
