import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractArticleFromHtml } from "../../src/modules/digital-profile/orion-golden/content-acquisition/extract-article";
import { selectSourceUrls } from "../../src/modules/digital-profile/orion-golden/content-acquisition/select-source-urls";
import { runSourceContentAcquisition } from "../../src/modules/digital-profile/orion-golden/content-acquisition/run-source-content-acquisition";
import { isNonArticleUrl } from "../../src/modules/digital-profile/orion-golden/content-acquisition/url-policy";
import type { Finding } from "../../src/modules/digital-profile/orion-golden/contracts/finding";
import type { RawInventoryItem } from "../../src/modules/digital-profile/orion-golden/types";

const FIXTURE_HTML = readFileSync(
  join(process.cwd(), "tests/fixtures/source-content/article-ru-en.html"),
  "utf8"
);

function item(partial: Partial<RawInventoryItem> & Pick<RawInventoryItem, "inventoryId" | "title" | "sourceUrl">): RawInventoryItem {
  return {
    caseId: "case-1",
    reportRunId: "run-1",
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
    caseId: "case-1",
    datasetId: "ds-1",
    sourceHashes: [],
    theme: "criminal",
    claim: "claim",
    subjectMatch: "SUBJECT_MATCH",
    riskLevel: "high",
    confidence: 0.9,
    regions: ["RU"],
    sourceDomains: ["news.example"],
    providers: ["serper"],
    recommendedAction: "review",
    contradictions: [],
    limitations: [],
    ...partial,
  };
}

describe("C1 extract-article", () => {
  it("extracts non-empty body, lang, and does not truncate", () => {
    const extracted = extractArticleFromHtml({
      html: FIXTURE_HTML,
      url: "https://news.example/article/1",
    });
    expect(extracted).not.toBeNull();
    expect(extracted!.extractedText.length).toBeGreaterThan(200);
    expect(extracted!.extractedText.includes("conflict of interest")).toBe(true);
    expect(extracted!.extractedTitle).toMatch(/Investigation fixture/i);
    expect(extracted!.extractedLang).toBeTruthy();
    expect(extracted!.sourceDate).toBe("2018-03-15T12:00:00Z");
    // spans-compatible: exact substring from source HTML text content path
    expect(FIXTURE_HTML.includes("conflict of interest")).toBe(true);
    const hash = createHash("sha256").update(extracted!.extractedText, "utf8").digest("hex");
    expect(extracted!.contentHash).toBe(hash);
  });
});

describe("C1 url policy", () => {
  it("flags youtube/instagram as non-article", () => {
    expect(isNonArticleUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isNonArticleUrl("https://instagram.com/p/xyz")).toBe(true);
    expect(isNonArticleUrl("https://www.theguardian.com/world/2020/a")).toBe(false);
  });
});

describe("C1 select + acquisition (offline)", () => {
  it("selects PRIMARY/SUPPORTING URLs and dedupes", () => {
    const items = [
      item({
        inventoryId: "a1",
        title: "Article A",
        sourceUrl: "https://news.example/a?utm_source=x",
      }),
      item({
        inventoryId: "a2",
        title: "Article A dup",
        sourceUrl: "https://news.example/a",
      }),
      item({
        inventoryId: "yt",
        title: "Organized crime group, officials, girls.",
        sourceUrl: "https://youtube.com/watch?v=1",
      }),
    ];
    const findings = [
      finding({
        findingId: "f1",
        promotionPriority: "P1",
        evidenceRefs: ["inventory:a1", "inventory:yt"],
      }),
      finding({
        findingId: "f2",
        promotionPriority: "P3",
        evidenceRefs: ["inventory:a2"],
      }),
    ];
    const selected = selectSourceUrls({ findings, items });
    expect(selected.length).toBe(2);
    const article = selected.find((s) => s.url.includes("news.example"));
    expect(article?.selectionTier).toBe("KEEP_PRIMARY");
    expect(article?.findingIds.sort()).toEqual(["f1", "f2"]);
    const yt = selected.find((s) => s.url.includes("youtube"));
    expect(yt?.notEligibleAsAdverseExample).toBe(true);
  });

  it("acquires full text via injected fetch; unavailable stays snippet_only; no silent drop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "c1-acq-"));
    try {
      const items = [
        item({
          inventoryId: "ok",
          title: "Good article",
          snippet: "serp snippet only",
          sourceUrl: "https://news.example/good",
        }),
        item({
          inventoryId: "bad",
          title: "Missing page",
          snippet: "gone",
          sourceUrl: "https://news.example/missing",
        }),
        item({
          inventoryId: "yt",
          title: "MEMES",
          sourceUrl: "https://instagram.com/p/meme",
        }),
      ];
      const findings = [
        finding({
          findingId: "f-ok",
          promotionPriority: "P1",
          evidenceRefs: ["inventory:ok"],
        }),
        finding({
          findingId: "f-bad",
          promotionPriority: "P2",
          evidenceRefs: ["inventory:bad"],
        }),
        finding({
          findingId: "f-yt",
          promotionPriority: "P1",
          evidenceRefs: ["inventory:yt"],
        }),
      ];

      let networkCalls = 0;
      const index = await runSourceContentAcquisition({
        caseId: "case-1",
        datasetId: "ds-1",
        artifactsDir: dir,
        findings,
        items,
        forceOffline: false,
        fetchPage: async ({ url }) => {
          networkCalls += 1;
          if (url.includes("/good")) {
            return { ok: true, html: FIXTURE_HTML, finalUrl: url, networkCalls: 1 };
          }
          return { ok: false, errorCode: "http_404", networkCalls: 1 };
        },
      });

      expect(index.entries.length).toBe(3);
      expect(index.coverage.SILENT_DROPS_ON_FETCH).toBe(0);
      expect(index.coverage.selected).toBe(3);

      const good = index.entries.find((e) => e.inventoryId === "ok")!;
      expect(good.contentSource).toBe("full_text");
      expect(good.extractedText!.length).toBeGreaterThan(100);
      expect(good.storageRef).toBeTruthy();

      const bad = index.entries.find((e) => e.inventoryId === "bad")!;
      expect(bad.contentSource).toBe("snippet_only");
      expect(bad.fetchStatus).toBe("failed");

      const yt = index.entries.find((e) => e.inventoryId === "yt")!;
      expect(yt.contentSource).toBe("snippet_only");
      expect(yt.notEligibleAsAdverseExample).toBe(true);
      expect(yt.fetchStatus).toBe("skipped_non_article");

      expect(index.coverage.PRIMARY_SUPPORTING_CONTENT_COVERAGE).toBeGreaterThan(0);
      expect(networkCalls).toBe(2);

      // Second run: cache hit → 0 network calls.
      let secondCalls = 0;
      const again = await runSourceContentAcquisition({
        caseId: "case-1",
        datasetId: "ds-1",
        artifactsDir: dir,
        findings,
        items,
        fetchPage: async () => {
          secondCalls += 1;
          return { ok: false, errorCode: "should_not_fetch", networkCalls: 1 };
        },
      });
      expect(again.entries.find((e) => e.inventoryId === "ok")!.fetchStatus).toBe("cached");
      expect(secondCalls).toBe(1); // missing still attempted once; good from cache
      // Force fully offline replay: NETWORK_CALLS=0 + no inject for missing already cached? 
      // Re-run with forceOffline — good from cache, others snippet, 0 network.
      const offline = await runSourceContentAcquisition({
        caseId: "case-1",
        datasetId: "ds-1",
        artifactsDir: dir,
        findings,
        items,
        forceOffline: true,
        fetchPage: async () => {
          throw new Error("network forbidden");
        },
      });
      expect(offline.coverage.networkCallsTotal).toBe(0);
      expect(offline.entries.find((e) => e.inventoryId === "ok")!.contentSource).toBe("full_text");
      expect(offline.entries.length).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("one URL in two findings → one fetch, provenance on both entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "c1-dedupe-"));
    try {
      const items = [
        item({
          inventoryId: "shared",
          title: "Shared",
          sourceUrl: "https://news.example/shared",
        }),
      ];
      // Same URL appears via two inventory aliases? select dedupes by URL — use two findings same ref.
      const findings = [
        finding({
          findingId: "f1",
          promotionPriority: "P1",
          evidenceRefs: ["inventory:shared"],
        }),
        finding({
          findingId: "f2",
          promotionPriority: "P3",
          evidenceRefs: ["inventory:shared"],
        }),
      ];
      let fetches = 0;
      const index = await runSourceContentAcquisition({
        caseId: "case-1",
        datasetId: "ds-1",
        artifactsDir: dir,
        findings,
        items,
        fetchPage: async ({ url }) => {
          fetches += 1;
          return { ok: true, html: FIXTURE_HTML, finalUrl: url, networkCalls: 1 };
        },
      });
      expect(fetches).toBe(1);
      expect(index.entries.length).toBe(1);
      expect(index.entries[0].findingIds.sort()).toEqual(["f1", "f2"]);
      expect(index.entries[0].contentSource).toBe("full_text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
