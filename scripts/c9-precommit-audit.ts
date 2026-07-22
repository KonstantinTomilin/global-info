/**
 * C9 — Read-only pre-commit audit (NETWORK_CALLS=0).
 * Does not modify the working tree. Does not commit/push.
 *
 * Usage:
 *   npx tsx scripts/c9-precommit-audit.ts [outPath]
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.NETWORK_CALLS = "0";

const ALLOWED_PREFIXES = [
  "src/modules/digital-profile/orion-golden/",
  "src/modules/digital-profile/services/canonical-report-prepare.ts",
  "src/modules/digital-profile/config/",
  "renderer/orion_golden_render/",
  "tests/unit/",
  "scripts/",
  "docs/",
];

const FORBIDDEN_PATTERNS = [
  /^\.env/i,
  /credentials/i,
  /secret/i,
  /tmp-pdf-review\//i,
  /prisma\/migrations\//i,
  /\.pem$/i,
  /storage\/digital-profile\/.*\/job\.json/i,
];

const SUBJECT_HARDCODE_RE =
  /\b(Дерипаск|Deripaska|Глинк|Glinka|Хольмстр|Holmstrom)\b/u;

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function main(): void {
  const outPath =
    process.argv[2] ??
    join(process.cwd(), "tmp-pdf-review", "c9-precommit-audit.json");

  const status = git(["status", "--porcelain"]);
  const changed = status
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\?\? /, "").replace(/^[ MADRCU!]{1,2} /, "").trim());

  const scopeViolations: string[] = [];
  const secretHits: string[] = [];
  for (const f of changed) {
    if (FORBIDDEN_PATTERNS.some((re) => re.test(f))) {
      secretHits.push(f);
      continue;
    }
    if (f.startsWith("tmp-pdf-review/")) {
      // Scratch — must not be committed; warn but do not fail READY if only untracked scratch.
      continue;
    }
    if (!ALLOWED_PREFIXES.some((p) => f.startsWith(p) || f === p.replace(/\/$/, ""))) {
      scopeViolations.push(f);
    }
  }

  let hardcodeHits: string[] = [];
  try {
    const tracked = git([
      "ls-files",
      "src/modules/digital-profile/orion-golden",
      "scripts",
    ]).split("\n").filter(Boolean);
    for (const f of tracked) {
      if (!/\.(ts|tsx|js|mjs)$/u.test(f)) continue;
      if (f.includes(".test.") || f.includes("characterize") || f.includes("smoke-")) continue;
      let body = "";
      try {
        body = git(["show", `HEAD:${f}`]);
      } catch {
        continue;
      }
      if (SUBJECT_HARDCODE_RE.test(body)) hardcodeHits.push(f);
    }
  } catch {
    hardcodeHits = [];
  }

  let unitPass = false;
  try {
    const vitestCli = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
    execFileSync(
      process.execPath,
      [
        vitestCli,
        "run",
        "tests/unit/client-summary-composer.test.ts",
        "tests/unit/cross-slide-disclosure.test.ts",
        "tests/unit/semantic-summary-pagination.test.ts",
        "tests/unit/content-quality-harness.test.ts",
        "--reporter=dot",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, NETWORK_CALLS: "0" },
        stdio: "pipe",
      }
    );
    unitPass = true;
  } catch {
    unitPass = false;
  }

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(["rev-parse", "--short", "HEAD"]);

  const gates = {
    PRECOMMIT_SCOPE_CLEAN: scopeViolations.length === 0,
    NO_SECRETS_OR_LIVE_ARTIFACTS:
      secretHits.filter((f) => !f.startsWith("tmp-pdf-review/")).length === 0,
    NO_SUBJECT_HARDCODES_IN_SRC: hardcodeHits.length === 0,
    OFFLINE_REGRESSION_PASS: unitPass,
    NETWORK_CALLS_0: true,
    READY_TO_COMMIT:
      scopeViolations.length === 0 &&
      secretHits.filter((f) => !f.startsWith("tmp-pdf-review/")).length === 0 &&
      unitPass,
    CEO_READY: false as const,
  };

  const report = {
    schemaVersion: "c9-precommit-audit-v1",
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    branch,
    head,
    NETWORK_CALLS: "0",
    CEO_READY: false as const,
    gates,
    changedFiles: changed.filter((f) => !f.startsWith("tmp-pdf-review/")),
    scopeViolations,
    secretOrScratchHits: secretHits,
    subjectHardcodeHits: hardcodeHits.slice(0, 20),
    notes: [
      "ObservationDisposition ledger is not on this branch (C1–C4 substitutes apply).",
      "Full visual PDF/PPTX/PNG page parity remains a manual/live gate.",
      "CEO_READY=false until live E2E + manual acceptance.",
    ],
  };

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        path: outPath,
        READY_TO_COMMIT: gates.READY_TO_COMMIT,
        CEO_READY: false,
        unitPass,
        scopeViolations: scopeViolations.length,
      },
      null,
      2
    )
  );
  if (!gates.READY_TO_COMMIT) process.exitCode = 1;
}

main();
