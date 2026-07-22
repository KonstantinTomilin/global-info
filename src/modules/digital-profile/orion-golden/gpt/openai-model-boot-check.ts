/**
 * C0 — Boot-time OpenAI model reachability gate.
 * Called from instrumentation after sync env validation.
 */

import { digitalProfileConfig } from "../../config";
import { probeOpenAiModelReachability } from "./openai-model-health";

/**
 * In production (or whenever deterministic fallback is forbidden): unreachable
 * model throws. In soft/dev mode: warn only.
 */
export async function runOpenAiModelBootHealthCheck(): Promise<void> {
  const ai = digitalProfileConfig.aiAnalyst;
  if (!ai.enabled) return;
  if (!ai.openAiApiKey || !ai.model) return;

  // Skip live probe when offline tests force NETWORK_CALLS=0.
  if (process.env.NETWORK_CALLS === "0") return;

  const result = await probeOpenAiModelReachability({
    apiKey: ai.openAiApiKey,
    model: ai.model,
    timeoutMs: Math.min(15_000, ai.timeoutMs),
  });

  if (result.ok) return;

  const detail = result.reason ?? `status_${result.status ?? "unknown"}`;
  const message = `OpenAI model health-check failed for DIGITAL_PROFILE_AI_ANALYST_MODEL=${ai.model}: ${detail}`;

  if (!digitalProfileConfig.orionV2AllowDeterministicFallback) {
    throw new Error(message);
  }
  console.warn(`[digital-profile][ai] WARN: ${message}`);
}
