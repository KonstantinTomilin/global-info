/**
 * Materialize remote image URLs into imageData before Python renderer (no URL fetch in renderer).
 * Always normalizes to PNG — python-pptx rejects WEBP.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ReportAssetV1 } from "../../orion-report-spec/asset-builder";
import { loadFile, saveFile, sha256 as hashBuf } from "../../storage/private-store";
import { buildStorageKey } from "../../storage/keys";

const ALLOWED_IMAGE_HOST_RE =
  /^https?:\/\/([a-z0-9.-]+\.)?(googleusercontent\.com|gstatic\.com|ytimg\.com|wikimedia\.org|wikipedia\.org|serper\.dev|bing\.net|yandex\.(ru|net)|doubleclick\.net)/i;

function isAllowlistedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return ALLOWED_IMAGE_HOST_RE.test(url) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  if (!isAllowlistedImageUrl(url)) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "image/*,image/webp" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200 || buf.length > 8 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Convert any raster (incl. WEBP) to PNG for python-pptx compatibility. */
export async function normalizeImageToPng(bytes: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(bytes).rotate().png().toBuffer();
  } catch {
    return null;
  }
}

export async function materializeReportAssetImages(input: {
  caseId: string;
  assets: ReportAssetV1[];
}): Promise<ReportAssetV1[]> {
  const out: ReportAssetV1[] = [];

  for (const asset of input.assets) {
    let bytes: Buffer | null = null;

    if (asset.imageData) {
      bytes = Buffer.from(asset.imageData, "base64");
    } else if (asset.imageUrl && asset.status === "ready") {
      bytes = await fetchImageBytes(asset.imageUrl);
      if (!bytes) {
        out.push({
          ...asset,
          status: "missing",
          failureReason: "image_url_fetch_failed",
        });
        continue;
      }
    } else {
      out.push(asset);
      continue;
    }

    const png = await normalizeImageToPng(bytes);
    if (!png) {
      out.push({
        ...asset,
        imageData: undefined,
        status: "missing",
        failureReason: "image_format_unsupported",
      });
      continue;
    }

    const digest = hashBuf(png);
    const key = buildStorageKey.imageThumbnail(input.caseId, digest.slice(0, 16), "png");
    try {
      await saveFile(key, png);
    } catch {
      try {
        await loadFile(key);
      } catch {
        out.push({ ...asset, status: "missing", failureReason: "storage_write_failed" });
        continue;
      }
    }

    out.push({
      ...asset,
      imageData: png.toString("base64"),
      sha256: digest,
      mimeType: "image/png",
      status: "ready",
    });
  }

  return out;
}

export function regionFromSurfaceMetadata(rm: Record<string, unknown>): "RU" | "UAE" {
  const r = String(rm.orionRegion ?? rm.region ?? "RU")
    .toUpperCase()
    .replace(/^INTERNATIONAL$/, "INTL");
  if (r === "UAE" || r === "AE" || r === "INTL") return "UAE";
  return "RU";
}

export function buildRegionAwareAssetRef(input: {
  prefix: string;
  region: "RU" | "UAE";
  provider: string;
  surface: string;
  id: string;
}): string {
  const safe = createHash("sha256").update(input.id).digest("hex").slice(0, 10);
  return `${input.prefix}_${input.region}_${input.provider}_${input.surface}_${safe}`;
}
