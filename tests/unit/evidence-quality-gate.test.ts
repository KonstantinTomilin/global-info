import { describe, expect, it } from "vitest";
import {
  buildEvidenceQualityDisposition,
  evaluateAdverseExampleEligibility,
} from "../../src/modules/digital-profile/orion-golden/analytics/evidence-quality-gate";
import {
  pickClaimExamples,
  resolveExampleQuote,
} from "../../src/modules/digital-profile/orion-golden/analytics/finding-synthesizer";
import type { RawInventoryItem } from "../../src/modules/digital-profile/orion-golden/types";
import { getFindingThemes } from "../../src/modules/digital-profile/config/finding-themes";

function item(
  partial: Partial<RawInventoryItem> & Pick<RawInventoryItem, "inventoryId" | "title">
): RawInventoryItem {
  return {
    caseId: "c",
    reportRunId: "r",
    source: "web",
    provider: "serper",
    region: "RU",
    collectedAt: "2026-01-01T00:00:00Z",
    evidenceType: "serp",
    ...partial,
  };
}

describe("C4 evidence-quality-gate", () => {
  it("rejects youtube / instagram / meme titles as adverse examples but keeps appendix trace", () => {
    const disposition = buildEvidenceQualityDisposition({
      caseId: "c",
      datasetId: "d",
      items: [
        {
          inventoryId: "yt",
          title: "Organized crime group, officials, girls.",
          url: "https://youtube.com/watch?v=1",
          contentSource: "snippet_only",
          notEligibleAsAdverseExample: true,
          themeId: "criminal_legal",
        },
        {
          inventoryId: "ig",
          title: "MEMES | Vladimir Putin",
          url: "https://instagram.com/p/x",
          contentSource: "snippet_only",
        },
        {
          inventoryId: "meme",
          title: "дерипаска попой об лед",
          url: "https://rutube.ru/video/1",
          contentSource: "snippet_only",
        },
        {
          inventoryId: "nyt",
          title:
            "Russian Oligarch Sues the U.S. Over Sanctions After Treasury Designation",
          url: "https://www.nytimes.com/2020/article",
          contentSource: "full_text",
          themeId: "criminal_legal",
        },
      ],
    });
    expect(disposition.gates.JUNK_AS_ADVERSE_EXAMPLE).toBe(0);
    expect(disposition.entries.length).toBe(4);
    const junk = disposition.entries.filter((e) =>
      ["yt", "ig", "meme"].includes(e.inventoryId)
    );
    expect(junk.every((e) => e.disposition === "APPENDIX_OTHER")).toBe(true);
    const nyt = disposition.entries.find((e) => e.inventoryId === "nyt")!;
    expect(nyt.disposition).toBe("ADVERSE_EXAMPLE");
  });

  it("pickClaimExamples never selects youtube junk for criminal theme; guardian/nyt remains", () => {
    const criminal = getFindingThemes().find((t) => t.themeId === "criminal_legal");
    expect(criminal).toBeTruthy();
    const items = [
      item({
        inventoryId: "yt",
        title: "Organized crime group, officials, girls.",
        sourceUrl: "https://www.youtube.com/watch?v=abc",
      }),
      item({
        inventoryId: "ig",
        title: "MEMES | 😭 politics",
        sourceUrl: "https://www.instagram.com/p/xyz",
      }),
      item({
        inventoryId: "guardian",
        title:
          "Businessman faces money-laundering investigation over offshore accounts",
        sourceUrl: "https://www.theguardian.com/world/2020/example",
        snippet: "Prosecutors investigate money laundering and criminal proceeds",
        rawMetadata: { contentSource: "full_text" },
      }),
    ];
    // Shuffle invariance: reverse order still picks guardian.
    for (const ordered of [items, [...items].reverse()]) {
      const examples = pickClaimExamples(ordered, criminal!);
      expect(examples.every((e) => !/youtube|instagram/i.test(e.domain))).toBe(true);
      expect(examples.some((e) => /guardian/i.test(e.domain))).toBe(true);
    }
    expect(resolveExampleQuote(items[0], criminal!)).toBeNull();
  });

  it("full_text passes even without keyword-dense title when not junk host", () => {
    const gate = evaluateAdverseExampleEligibility({
      title: "Detailed report on corporate structure and related risks",
      url: "https://www.reuters.com/article/1",
      contentSource: "full_text",
    });
    expect(gate.eligibleAsAdverseExample).toBe(true);
  });
});
