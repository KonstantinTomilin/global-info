/**
 * C0 — OpenAI model reachability probe (boot / health / diagnostics).
 *
 * Uses GET /v1/models/{model} — cheap, no completion tokens. Never logs secrets.
 */

export type OpenAiModelHealthResult = {
  ok: boolean;
  model: string;
  status?: number;
  reason?: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Probe whether `model` is visible to the API key.
 * Injectable fetch for offline tests (NETWORK_CALLS=0).
 */
export async function probeOpenAiModelReachability(input: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<OpenAiModelHealthResult> {
  const model = input.model.trim();
  if (!model) {
    return { ok: false, model: "", reason: "model_id_missing" };
  }
  if (!input.apiKey.trim()) {
    return { ok: false, model, reason: "api_key_missing" };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const encoded = encodeURIComponent(model);
    const res = await fetchImpl(`https://api.openai.com/v1/models/${encoded}`, {
      method: "GET",
      headers: { authorization: `Bearer ${input.apiKey}` },
      signal: controller.signal,
    });
    if (res.ok) {
      return { ok: true, model, status: res.status };
    }
    return {
      ok: false,
      model,
      status: res.status,
      reason: `openai_models_http_${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = /abort/i.test(msg) ? "openai_models_timeout" : "openai_models_unreachable";
    return { ok: false, model, reason };
  } finally {
    clearTimeout(timer);
  }
}
