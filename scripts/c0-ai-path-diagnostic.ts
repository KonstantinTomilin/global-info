/**
 * C0 — Prove the AI report path executes on a saved Deripaska case dump.
 *
 * - No new paid collection
 * - One live GPT prepare of deck stage-1 + stage-2 against tmp-pdf-review/diag-30
 * - Writes AI_PATH report under tmp-pdf-review/c0-ai-path-diagnostic/
 *
 * Run: npx tsx scripts/c0-ai-path-diagnostic.ts
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const REPO = process.cwd();
loadEnvFile(join(REPO, ".env"));

// This script is the explicit C0 live exception: force network on even if the
// shell/session has NETWORK_CALLS=0 from offline work.
process.env.NETWORK_CALLS = "1";
process.env.DIGITAL_PROFILE_AI_ANALYST_ENABLED ??= "true";
process.env.ORION_GPT_REPORT_COPY ??= "1";
if (!process.env.DIGITAL_PROFILE_AI_ANALYST_MODEL?.trim()) {
  process.env.DIGITAL_PROFILE_AI_ANALYST_MODEL = "gpt-5.6-sol";
}

async function main(): Promise<void> {
  const { probeOpenAiModelReachability } = await import(
    "../src/modules/digital-profile/orion-golden/gpt/openai-model-health"
  );

  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  let model = (process.env.DIGITAL_PROFILE_AI_ANALYST_MODEL ?? "").trim();
  let health = await probeOpenAiModelReachability({ apiKey, model });
  let modelNote: string | undefined;
  if (!health.ok && model === "gpt-5.6-sol") {
    const alias = await probeOpenAiModelReachability({ apiKey, model: "gpt-5.6" });
    if (alias.ok) {
      process.env.DIGITAL_PROFILE_AI_ANALYST_MODEL = "gpt-5.6";
      model = "gpt-5.6";
      health = alias;
      modelNote = "gpt-5.6-sol unreachable; using alias gpt-5.6 for this run";
    }
  }

  const { digitalProfileConfig } = await import(
    "../src/modules/digital-profile/config"
  );
  const { evaluateGptFallbackPolicy, countStage2Outcomes } = await import(
    "../src/modules/digital-profile/orion-golden/gpt/gpt-fallback-policy"
  );
  const { loadDeckInputsFromAnalyticsDir } = await import(
    "../src/modules/digital-profile/orion-golden/deck-sections/load-deck-inputs"
  );
  const { runDeckBuildWithGptCopy } = await import(
    "../src/modules/digital-profile/orion-golden/deck-sections/gpt-enhanced-deck-build"
  );
  const { runGptCaseAnalysis } = await import(
    "../src/modules/digital-profile/orion-golden/gpt/gpt-case-analysis"
  );
  const { callOpenAiStrictJsonOnce } = await import(
    "../src/modules/digital-profile/orion-golden/gpt/openai-json-client"
  );

  const src = join(REPO, "tmp-pdf-review", "diag-30");
  const outRoot = join(REPO, "tmp-pdf-review", "c0-ai-path-diagnostic");
  const work = join(outRoot, "workdir");
  mkdirSync(outRoot, { recursive: true });

  if (!existsSync(join(src, "analytics"))) {
    throw new Error(`missing saved case analytics at ${src}/analytics`);
  }

  cpSync(join(src, "analytics"), join(work, "analytics"), { recursive: true });
  if (existsSync(join(src, "subject-identity-profile.json"))) {
    cpSync(
      join(src, "subject-identity-profile.json"),
      join(work, "subject-identity-profile.json")
    );
  }

  const ai = digitalProfileConfig.aiAnalyst;
  const report: Record<string, unknown> = {
    version: "c0-ai-path-diagnostic-v1",
    at: new Date().toISOString(),
    sourceCase: "tmp-pdf-review/diag-30",
    modelConfigured: ai.model,
    aiEnabled: ai.enabled,
    healthCheck: health,
    note: modelNote ?? null,
    CEO_READY: false,
  };

  if (!ai.enabled || !ai.openAiApiKey || !ai.model.trim()) {
    report.AI_PATH_EXECUTED = false;
    report.blocker = "AI not configured (enabled/key/model)";
    writeFileSync(join(outRoot, "c0-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  if (!health.ok) {
    report.AI_PATH_EXECUTED = false;
    report.blocker = `model unreachable: ${health.reason}`;
    writeFileSync(join(outRoot, "c0-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const analyticsDir = join(work, "analytics");
  const deckDir = join(work, "deck");
  mkdirSync(deckDir, { recursive: true });
  const deckInputs = loadDeckInputsFromAnalyticsDir(analyticsDir);

  const subjectPath = join(work, "subject-identity-profile.json");
  const subject = existsSync(subjectPath)
    ? (JSON.parse(readFileSync(subjectPath, "utf8")) as {
        displayName?: string;
        aliases?: string[];
        contextIdentifiers?: string[];
      })
    : { displayName: deckInputs.caseId, aliases: [], contextIdentifiers: [] };

  const caller = async (args: {
    systemPrompt: string;
    userPayload: unknown;
    maxOutputTokens?: number;
  }) => callOpenAiStrictJsonOnce(args);

  console.log(`C0: stage-1 case analysis with model=${ai.model}…`);
  let stage1Applied = false;
  let stage1Failure: string | null = null;
  const caseAnalysis = await runGptCaseAnalysis({
    caller,
    subjectName: subject.displayName ?? "subject",
    aliases: subject.aliases ?? [],
    contextIdentifiers: subject.contextIdentifiers ?? [],
    bundle: deckInputs.mergedBundle,
    surfaceUnits: deckInputs.surfaceUnits,
    metricSnapshot: deckInputs.metricSnapshot,
    onFailure: (reason) => {
      stage1Failure = reason;
    },
  });
  if (caseAnalysis) {
    stage1Applied = true;
    writeFileSync(
      join(analyticsDir, "gpt-case-analysis.json"),
      `${JSON.stringify(caseAnalysis, null, 2)}\n`,
      "utf8"
    );
  }

  console.log("C0: stage-2 deck GPT copy (forceRefresh)…");
  await runDeckBuildWithGptCopy({
    ctx: {
      caseId: deckInputs.caseId,
      reportRunId: deckInputs.reportRunId,
      sourceDatasetId: deckInputs.sourceDatasetId,
      contentVersion: "deck-sections-c0-diag",
      subject: {
        displayName: subject.displayName ?? "subject",
        aliases: subject.aliases ?? [],
      },
      bundle: deckInputs.mergedBundle,
      surfaceUnits: deckInputs.surfaceUnits,
      metricSnapshot: deckInputs.metricSnapshot,
      evidenceIndex: deckInputs.evidenceIndex,
      extras: {
        executiveSummary: deckInputs.executiveSummary as never,
        gptCaseAnalysis: caseAnalysis ?? undefined,
        uncategorizedMaterials: deckInputs.uncategorizedMaterials ?? undefined,
        surfaceCollectionHints: deckInputs.surfaceCollectionHints,
      },
    },
    bundleForValidation: deckInputs.mergedBundle,
    knownEvidenceRefs: deckInputs.knownEvidenceRefs,
    outputRoot: deckDir,
    baseObservationCountBefore: deckInputs.baseCountBefore,
    baseObservationCountAfter: deckInputs.baseCountAfter,
    gpt: { caller, caseAnalysis },
    forceGptCopy: true,
  });

  const copyPath = join(deckDir, "gpt-report-copy.json");
  const copy = existsSync(copyPath)
    ? (JSON.parse(readFileSync(copyPath, "utf8")) as {
        caseAnalysisUsed?: boolean;
        fragments?: Array<{ fragmentKey: string; status: string; detail?: string }>;
      })
    : { fragments: [] };

  const fragments = copy.fragments ?? [];
  const outcomes = countStage2Outcomes(fragments);
  const statusCounts: Record<string, number> = {};
  for (const f of fragments) {
    statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
  }

  const policy = evaluateGptFallbackPolicy({
    allowDeterministicFallback: false,
    aiEnabled: true,
    gptCallerPresent: true,
    stage1Applied,
    stage2Fragments: fragments,
  });

  const appliedOnData = fragments.filter((f) => f.status === "APPLIED");
  const fallbackOnData = fragments.filter((f) => f.status.startsWith("FALLBACK_"));
  const AI_PATH_EXECUTED =
    stage1Applied && appliedOnData.length > 0 && policy.ok;

  report.AI_PATH_EXECUTED = AI_PATH_EXECUTED;
  report.stage1 = {
    applied: stage1Applied,
    failure: stage1Failure,
    caseAnalysisUsed: Boolean(copy.caseAnalysisUsed),
  };
  report.stage2 = {
    outcomes,
    statusCounts,
    appliedFragments: appliedOnData.map((f) => f.fragmentKey),
    fallbackFragments: fallbackOnData.map((f) => ({
      fragmentKey: f.fragmentKey,
      status: f.status,
      detail: f.detail ?? null,
    })),
    allFragments: fragments.map((f) => ({
      fragmentKey: f.fragmentKey,
      status: f.status,
    })),
  };
  report.fallbackPolicyStrict = policy;
  report.workdir = work;

  writeFileSync(join(outRoot, "c0-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!AI_PATH_EXECUTED) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
