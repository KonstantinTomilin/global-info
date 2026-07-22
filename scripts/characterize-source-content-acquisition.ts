/**
 * C1 offline characterize — NETWORK_CALLS=0 suite + coverage report.
 * Run: npx tsx scripts/characterize-source-content-acquisition.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractArticleFromHtml } from "../src/modules/digital-profile/orion-golden/content-acquisition/extract-article";
import { runSourceContentAcquisition } from "../src/modules/digital-profile/orion-golden/content-acquisition/run-source-content-acquisition";
import { isNonArticleUrl } from "../src/modules/digital-profile/orion-golden/content-acquisition/url-policy";
import type { Finding } from "../src/modules/digital-profile/orion-golden/contracts/finding";
import type { RawInventoryItem } from "../src/modules/digital-profile/orion-golden/types";

process.env.NETWORK_CALLS = "0";

const REPO = process.cwd();
const OUT = join(REPO, "tmp-pdf-review", "c1-source-content");
const FIXTURE = readFileSync(
  join(REPO, "tests/fixtures/source-content/article-ru-en.html"),
  "utf8"
);

function item(
  partial: Partial<RawInventoryItem> &
    Pick<RawInventoryItem, "inventoryId" | "title" | "sourceUrl">
): RawInventoryItem {
  return {
    caseId: "c1-case",
    reportRunId: "c1-run",
    source: "web",
    provider: "serper",
    region: "RU",
    collectedAt: "2026-01-01T00:00:00Z",
    evidenceType: "serp_organic",
    ...partial,
  };
}

function finding(
  partial: Partial<Finding> &
    Pick<Finding, "findingId" | "evidenceRefs" | "promotionPriority">
): Finding {
  return {
    schemaVersion: "finding-v2",
    caseId: "c1-case",
    datasetId: "c1-ds",
    sourceHashes: [],
    theme: "criminal",
    claim: "claim",
    subjectMatch: "SUBJECT_MATCH",
    riskLevel: "high",
    confidence: 0.9,
    regions: ["RU"],
    sourceDomains: ["example.com"],
    providers: ["serper"],
    recommendedAction: "review",
    contradictions: [],
    limitations: [],
    ...partial,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const extracted = extractArticleFromHtml({
    html: FIXTURE,
    url: "https://news.example/fixture",
  });

  const items = [
    item({
      inventoryId: "article",
      title: "Fixture article",
      snippet: "serp",
      sourceUrl: "https://news.example/fixture",
    }),
    item({
      inventoryId: "missing",
      title: "Missing",
      snippet: "serp missing",
      sourceUrl: "https://news.example/404",
    }),
    item({
      inventoryId: "yt",
      title: "Organized crime group, officials, girls.",
      sourceUrl: "https://youtube.com/watch?v=junk",
    }),
  ];
  const findings = [
    finding({
      findingId: "f-article",
      promotionPriority: "P1",
      evidenceRefs: ["inventory:article"],
    }),
    finding({
      findingId: "f-missing",
      promotionPriority: "P2",
      evidenceRefs: ["inventory:missing"],
    }),
    finding({
      findingId: "f-yt",
      promotionPriority: "P1",
      evidenceRefs: ["inventory:yt"],
    }),
  ];

  const work = join(OUT, "workdir");
  mkdirSync(work, { recursive: true });

  const first = await runSourceContentAcquisition({
    caseId: "c1-case",
    datasetId: "c1-ds",
    artifactsDir: work,
    findings,
    items,
    fetchPage: async ({ url }) => {
      if (url.includes("/fixture")) {
        return { ok: true, html: FIXTURE, finalUrl: url, networkCalls: 1 };
      }
      return { ok: false, errorCode: "http_404", networkCalls: 1 };
    },
  });

  let secondNetwork = 0;
  const second = await runSourceContentAcquisition({
    caseId: "c1-case",
    datasetId: "c1-ds",
    artifactsDir: work,
    findings,
    items,
    forceOffline: true,
    fetchPage: async () => {
      secondNetwork += 1;
      throw new Error("network forbidden on replay");
    },
  });

  const report = {
    version: "c1-source-content-characterize-v1",
    at: new Date().toISOString(),
    CEO_READY: false,
    gates: {
      PRIMARY_SUPPORTING_CONTENT_COVERAGE:
        first.coverage.PRIMARY_SUPPORTING_CONTENT_COVERAGE,
      SILENT_DROPS_ON_FETCH: first.coverage.SILENT_DROPS_ON_FETCH,
      REPLAY_NETWORK_CALLS: second.coverage.networkCallsTotal + secondNetwork,
      EXTRACTED_TEXT_TRUNCATED: extracted
        ? extracted.extractedText.length < 80
        : true,
      YOUTUBE_NOT_ELIGIBLE: isNonArticleUrl("https://youtube.com/watch?v=junk"),
    },
    firstCoverage: first.coverage,
    secondCoverage: second.coverage,
    extractSample: extracted
      ? {
          lang: extracted.extractedLang,
          title: extracted.extractedTitle,
          textChars: extracted.extractedText.length,
          contentHash: extracted.contentHash,
        }
      : null,
    PASS:
      first.coverage.SILENT_DROPS_ON_FETCH === 0 &&
      second.coverage.networkCallsTotal === 0 &&
      secondNetwork === 0 &&
      Boolean(extracted && extracted.extractedText.length >= 80) &&
      first.coverage.primarySupportingFullText >= 1,
  };

  writeFileSync(join(OUT, "c1-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.PASS) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
