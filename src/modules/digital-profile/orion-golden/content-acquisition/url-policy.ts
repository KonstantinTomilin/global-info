/**
 * C1 — Classify URLs that cannot yield a meaningful article body
 * (social / video / image hosts / thin aggregators).
 */

const NON_ARTICLE_HOST_RE =
  /(?:^|\.)((?:youtube|youtu|vimeo|rutube|tiktok|instagram|facebook|fb|twitter|x|t\.me|telegram|vk|ok\.ru|pinterest|reddit|threads\.net|cdninstagram|twimg|ytimg|imgur|giphy|tenor)\.)/i;

const NON_ARTICLE_PATH_RE =
  /\/(shorts|reel|reels|watch|status|stories|photo|photos|video|videos|embed)\b/i;

export function isNonArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (NON_ARTICLE_HOST_RE.test(host)) return true;
    if (NON_ARTICLE_PATH_RE.test(u.pathname)) return true;
    return false;
  } catch {
    return true;
  }
}

export function normalizeSourceUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/^https?:$/i.test(u.protocol)) return null;
    u.hash = "";
    // Drop common tracking params for cache key stability.
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}
