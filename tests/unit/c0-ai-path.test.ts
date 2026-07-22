import { describe, expect, it } from "vitest";
import {
  countStage2Outcomes,
  evaluateGptFallbackPolicy,
} from "../../src/modules/digital-profile/orion-golden/gpt/gpt-fallback-policy";
import { probeOpenAiModelReachability } from "../../src/modules/digital-profile/orion-golden/gpt/openai-model-health";
import { validateDigitalProfileEnv } from "../../src/modules/digital-profile/config/env-validation";

describe("C0 gpt-fallback-policy", () => {
  it("allows deterministic path when fallback is explicitly allowed", () => {
    const r = evaluateGptFallbackPolicy({
      allowDeterministicFallback: true,
      aiEnabled: true,
      gptCallerPresent: false,
      stage1Applied: false,
      stage2Fragments: [{ fragmentKey: "executive/summary", status: "FALLBACK_ERROR" }],
    });
    expect(r).toEqual({ ok: true });
  });

  it("allows deterministic path when AI is disabled even if fallback is forbidden", () => {
    const r = evaluateGptFallbackPolicy({
      allowDeterministicFallback: false,
      aiEnabled: false,
      gptCallerPresent: false,
      stage1Applied: false,
      stage2Fragments: [],
    });
    expect(r).toEqual({ ok: true });
  });

  it("blocks missing caller in production-like mode (AI on, fallback forbidden)", () => {
    const r = evaluateGptFallbackPolicy({
      allowDeterministicFallback: false,
      aiEnabled: true,
      gptCallerPresent: false,
      stage1Applied: false,
      stage2Fragments: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GPT_CALLER_UNAVAILABLE");
  });

  it("blocks stage-1 failure with zero APPLIED stage-2 fragments", () => {
    const r = evaluateGptFallbackPolicy({
      allowDeterministicFallback: false,
      aiEnabled: true,
      gptCallerPresent: true,
      stage1Applied: false,
      stage2Fragments: [
        { fragmentKey: "executive/summary", status: "FALLBACK_ERROR" },
        { fragmentKey: "ru/serp", status: "SKIPPED_EMPTY" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GPT_LAYER_FALLBACK_FORBIDDEN");
  });

  it("blocks all-FALLBACK data fragments with zero APPLIED", () => {
    const r = evaluateGptFallbackPolicy({
      allowDeterministicFallback: false,
      aiEnabled: true,
      gptCallerPresent: true,
      stage1Applied: true,
      stage2Fragments: [
        { fragmentKey: "a", status: "FALLBACK_TIMEOUT" },
        { fragmentKey: "b", status: "FALLBACK_VALIDATION" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GPT_LAYER_FALLBACK_FORBIDDEN");
  });

  it("passes when stage-2 has APPLIED fragments", () => {
    const r = evaluateGptFallbackPolicy({
      allowDeterministicFallback: false,
      aiEnabled: true,
      gptCallerPresent: true,
      stage1Applied: true,
      stage2Fragments: [
        { fragmentKey: "a", status: "APPLIED" },
        { fragmentKey: "b", status: "FALLBACK_ERROR" },
      ],
    });
    expect(r).toEqual({ ok: true });
    expect(countStage2Outcomes([{ fragmentKey: "a", status: "APPLIED" }]).applied).toBe(1);
  });
});

describe("C0 openai-model-health (offline)", () => {
  it("reports missing model without network", async () => {
    const r = await probeOpenAiModelReachability({
      apiKey: "sk-test",
      model: "",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("model_id_missing");
  });

  it("treats HTTP 200 as reachable", async () => {
    const r = await probeOpenAiModelReachability({
      apiKey: "sk-test",
      model: "gpt-5.6-sol",
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: "gpt-5.6-sol" }), { status: 200 }),
    });
    expect(r.ok).toBe(true);
  });

  it("treats HTTP 404 as unreachable", async () => {
    const r = await probeOpenAiModelReachability({
      apiKey: "sk-test",
      model: "gpt-5.5",
      fetchImpl: async () => new Response("missing", { status: 404 }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("openai_models_http_404");
  });
});

describe("C0 env-validation model id", () => {
  it("errors in production when AI enabled without model id", () => {
    const r = validateDigitalProfileEnv({
      NODE_ENV: "production",
      DIGITAL_PROFILE_ENABLED: "true",
      DATABASE_URL: "postgres://x",
      DIGITAL_PROFILE_STORAGE_DRIVER: "local",
      DIGITAL_PROFILE_AI_ANALYST_ENABLED: "true",
      DIGITAL_PROFILE_AI_ANALYST_MODEL: "",
      OPENAI_API_KEY: "sk-test",
      DIGITAL_PROFILE_ORION_V2_ALLOW_DETERMINISTIC_FALLBACK: "false",
      DIGITAL_PROFILE_SIGNED_URL_SECRET: "a-sufficiently-long-secret",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("DIGITAL_PROFILE_AI_ANALYST_MODEL"))).toBe(true);
  });
});
