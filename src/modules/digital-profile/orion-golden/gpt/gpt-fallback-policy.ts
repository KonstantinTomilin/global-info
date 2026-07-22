/**
 * C0 — Policy for silent deterministic GPT fallback vs fail-loud.
 *
 * Pure helpers so offline unit tests can prove production cannot mask GPT
 * failure as a successful AI path.
 */

export type GptSlideCopyFragmentLike = {
  fragmentKey: string;
  status: string;
};

export type GptFallbackPolicyInput = {
  allowDeterministicFallback: boolean;
  /** When AI analyst is off, deterministic reports are intentional (not a silent AI fallback). */
  aiEnabled: boolean;
  /** Live/injected GPT caller is available for this prepare. */
  gptCallerPresent: boolean;
  /** Stage-1 case analysis produced a usable artifact. */
  stage1Applied: boolean;
  /** Stage-2 fragment statuses from gpt-report-copy.json (may be empty). */
  stage2Fragments: GptSlideCopyFragmentLike[];
};

export type GptFallbackPolicyResult =
  | { ok: true }
  | {
      ok: false;
      code: "GPT_CALLER_UNAVAILABLE" | "GPT_LAYER_FALLBACK_FORBIDDEN";
      reason: string;
    };

const FALLBACK_PREFIX = "FALLBACK_";

/** Fragments that were attempted for live rewrite (not empty/deterministic skips). */
export function isGptDataFragmentAttempt(status: string): boolean {
  return (
    status === "APPLIED" ||
    status === "NO_CHANGES" ||
    status === "SKIPPED_CACHED" ||
    status.startsWith(FALLBACK_PREFIX)
  );
}

export function countStage2Outcomes(fragments: GptSlideCopyFragmentLike[]): {
  applied: number;
  fallback: number;
  attempted: number;
} {
  let applied = 0;
  let fallback = 0;
  let attempted = 0;
  for (const f of fragments) {
    if (!isGptDataFragmentAttempt(f.status)) continue;
    attempted += 1;
    if (f.status === "APPLIED" || f.status === "SKIPPED_CACHED") applied += 1;
    if (f.status.startsWith(FALLBACK_PREFIX)) fallback += 1;
  }
  return { applied, fallback, attempted };
}

/**
 * When deterministic fallback is allowed (dev/QA), always ok.
 * When AI is disabled, deterministic path is intentional — always ok.
 * When AI is on and fallback forbidden: missing caller, failed stage-1 with no
 * stage-2 apply, or data-slide FALLBACK_* with zero APPLIED → blocker.
 */
export function evaluateGptFallbackPolicy(
  input: GptFallbackPolicyInput
): GptFallbackPolicyResult {
  if (input.allowDeterministicFallback) return { ok: true };
  if (!input.aiEnabled) return { ok: true };

  if (!input.gptCallerPresent) {
    return {
      ok: false,
      code: "GPT_CALLER_UNAVAILABLE",
      reason:
        "deterministic GPT fallback forbidden but no GPT caller is available (missing key/model, NETWORK_CALLS=0, or ORION_GPT_REPORT_COPY=0)",
    };
  }

  const s2 = countStage2Outcomes(input.stage2Fragments);
  if (!input.stage1Applied && s2.applied === 0) {
    return {
      ok: false,
      code: "GPT_LAYER_FALLBACK_FORBIDDEN",
      reason:
        "deterministic GPT fallback forbidden: stage-1 case analysis did not apply and stage-2 has no APPLIED fragments",
    };
  }

  if (s2.attempted > 0 && s2.fallback > 0 && s2.applied === 0) {
    return {
      ok: false,
      code: "GPT_LAYER_FALLBACK_FORBIDDEN",
      reason: `deterministic GPT fallback forbidden: ${s2.fallback}/${s2.attempted} stage-2 data fragments are FALLBACK_* with zero APPLIED`,
    };
  }

  return { ok: true };
}
