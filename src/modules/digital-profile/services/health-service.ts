/**
 * Aggregate health for the Digital Profile module (Stage M2).
 *
 * Combines the Prisma DB ping with the Prisma-free storage/renderer checks.
 * Reveals component status + authEnabled only — never secrets or connection
 * strings.
 */

import { prisma } from "@/server/prisma/client";
import { isAuthEnabled } from "../auth/auth-config";
import { digitalProfileConfig } from "../config";
import { probeOpenAiModelReachability } from "../orion-golden/gpt/openai-model-health";
import {
  checkRendererHealth,
  checkStorageHealth,
  composeHealth,
  type ComponentStatus,
  type HealthReport,
} from "./health-checks";

export async function checkDatabaseHealth(): Promise<ComponentStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}

async function checkOpenAiModelHealth(): Promise<{
  status: ComponentStatus | "skipped";
  modelId?: string;
  reason?: string;
}> {
  const ai = digitalProfileConfig.aiAnalyst;
  if (!ai.enabled) return { status: "skipped" };
  if (!ai.openAiApiKey || !ai.model.trim()) {
    return { status: "error", modelId: ai.model || undefined, reason: "model_or_key_missing" };
  }
  if (process.env.NETWORK_CALLS === "0") {
    return { status: "skipped", modelId: ai.model, reason: "NETWORK_CALLS=0" };
  }
  const probe = await probeOpenAiModelReachability({
    apiKey: ai.openAiApiKey,
    model: ai.model,
    timeoutMs: Math.min(15_000, ai.timeoutMs),
  });
  return {
    status: probe.ok ? "ok" : "error",
    modelId: ai.model,
    reason: probe.ok ? undefined : probe.reason,
  };
}

export async function getDigitalProfileHealth(): Promise<HealthReport> {
  const [database, storage, renderer, openAi] = await Promise.all([
    checkDatabaseHealth(),
    checkStorageHealth(),
    checkRendererHealth(),
    checkOpenAiModelHealth(),
  ]);
  return composeHealth({
    database,
    storage,
    renderer,
    authEnabled: isAuthEnabled(),
    openAiModel: openAi.status,
    openAiModelId: openAi.modelId,
    openAiModelReason: openAi.reason,
  });
}
