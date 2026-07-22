/**
 * C1 — Fetch HTML for article URLs.
 * Prefer lightweight HTTP GET; optional Playwright for JS-heavy pages.
 * Injectable for offline tests (NETWORK_CALLS=0).
 */

export type PageFetchResult = {
  ok: boolean;
  finalUrl?: string;
  html?: string;
  status?: number;
  errorCode?: string;
  networkCalls: number;
};

export type PageFetchFn = (input: {
  url: string;
  timeoutMs?: number;
}) => Promise<PageFetchResult>;

/**
 * Default HTTP fetch — no Playwright dependency for the common static case.
 * Live only when NETWORK_CALLS != 0.
 */
export const defaultHttpPageFetch: PageFetchFn = async (input) => {
  if (process.env.NETWORK_CALLS === "0") {
    return { ok: false, errorCode: "NETWORK_CALLS_0", networkCalls: 0 };
  }
  const timeoutMs = input.timeoutMs ?? 25_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; ORION-SourceContentAcquisition/1.0; +compliance-research)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (res.status === 401 || res.status === 403 || res.status === 451) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url,
        errorCode: `paywall_or_forbidden_${res.status}`,
        networkCalls: 1,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url,
        errorCode: `http_${res.status}`,
        networkCalls: 1,
      };
    }
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ctype && !ctype.includes("html") && !ctype.includes("xml") && !ctype.includes("text/")) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url,
        errorCode: "non_html_content",
        networkCalls: 1,
      };
    }
    const html = await res.text();
    return {
      ok: true,
      status: res.status,
      finalUrl: res.url,
      html,
      networkCalls: 1,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorCode = /abort/i.test(msg) ? "timeout" : "fetch_failed";
    return { ok: false, errorCode, networkCalls: 1 };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Playwright-backed fetch for JS pages (reuses serp-capture Chromium stack).
 * Skips screenshot; returns HTML only.
 */
export const playwrightPageFetch: PageFetchFn = async (input) => {
  if (process.env.NETWORK_CALLS === "0") {
    return { ok: false, errorCode: "NETWORK_CALLS_0", networkCalls: 0 };
  }
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "ru-RU" });
      const page = await context.newPage();
      await page.goto(input.url, {
        waitUntil: "domcontentloaded",
        timeout: input.timeoutMs ?? 45_000,
      });
      await page.waitForTimeout(800);
      const finalUrl = page.url();
      const html = await page.content();
      await context.close();
      return { ok: true, finalUrl, html, networkCalls: 1 };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errorCode: `playwright_${msg.slice(0, 80)}`, networkCalls: 1 };
  }
};
