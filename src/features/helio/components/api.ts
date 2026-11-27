"use client";

import { send, streamJson } from "@/platform/client/api";
import { LIMITS } from "../domain/limits";
import { analyzeRgbaPixels } from "../domain/telemetry";
import {
  type BrandAuditResult,
  type CompareStreamEvent,
  type HelioModelTier,
  type OpticalTelemetry,
  type RenderedFrame,
  ROUTES,
  type ShootStreamEvent,
} from "../domain/types";

export type ProductPayload =
  | { kind: "specimen"; slug: string }
  | {
      kind: "custom";
      name: string;
      category: string;
      materialNotes: string;
      imageDataUrl: string;
    };

function approxDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return dataUrl.length;
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

/**
 * Downscales and re-encodes any image data URL in the browser so single images
 * stay well under `LIMITS.maxUploadBytes` (~1 MB) and multi-image payloads
 * (`edit` carries up to 3 images) always fit comfortably inside Vercel's 4.5 MB cap.
 */
export async function compressImageDataUrl(
  dataUrl: string,
  options: { maxDim?: number; preserveAlpha?: boolean } = {},
): Promise<string> {
  const maxDim = options.maxDim ?? 1024;
  const preserveAlpha = options.preserveAlpha ?? false;

  // Already compact and no forced re-encode needed
  if (!preserveAlpha && approxDataUrlBytes(dataUrl) <= 320_000) {
    return dataUrl;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode image for upload."));
    el.src = dataUrl;
  });

  const srcW = img.naturalWidth || maxDim;
  const srcH = img.naturalHeight || maxDim;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  if (!preserveAlpha) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetW, targetH);
  } else {
    ctx.clearRect(0, 0, targetW, targetH);
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // For alpha plates try WebP with alpha first (typically 10x smaller than PNG).
  const mime = preserveAlpha ? "image/webp" : "image/jpeg";
  for (const quality of [0.86, 0.74, 0.62]) {
    const encoded = canvas.toDataURL(mime, quality);
    // Safari fallback: if browser returned PNG instead of WebP, check size too.
    if (approxDataUrlBytes(encoded) <= LIMITS.maxUploadBytes - 40_000) {
      return encoded;
    }
  }

  // Final safeguard: keep shrinking until it fits (older Safari may return PNG
  // for WebP, which is much larger), and refuse clearly if it never does.
  let source: HTMLCanvasElement = canvas;
  for (let attempt = 0; attempt < 5; attempt++) {
    const smallCanvas = document.createElement("canvas");
    smallCanvas.width = Math.max(1, Math.round(source.width * 0.65));
    smallCanvas.height = Math.max(1, Math.round(source.height * 0.65));
    const sCtx = smallCanvas.getContext("2d");
    if (!sCtx) break;
    if (!preserveAlpha) {
      sCtx.fillStyle = "#ffffff";
      sCtx.fillRect(0, 0, smallCanvas.width, smallCanvas.height);
    }
    sCtx.drawImage(source, 0, 0, smallCanvas.width, smallCanvas.height);
    const encoded = smallCanvas.toDataURL(mime, 0.78);
    if (approxDataUrlBytes(encoded) <= LIMITS.maxUploadBytes - 40_000) {
      return encoded;
    }
    source = smallCanvas;
  }
  throw new Error(
    "That image is too large to send, even after shrinking it. Try a smaller JPEG or PNG.",
  );
}

async function compressProductPayload(
  product: ProductPayload,
): Promise<ProductPayload> {
  if (product.kind !== "custom") return product;
  const compressed = await compressImageDataUrl(product.imageDataUrl, {
    maxDim: 896,
    preserveAlpha: true,
  });
  return { ...product, imageDataUrl: compressed };
}

export async function postExtractPlate(
  body:
    | { mode: "isolate"; imageDataUrl: string; productName?: string }
    | { mode: "synthesize"; concept: string; productName?: string },
  signal?: AbortSignal,
): Promise<RenderedFrame> {
  const payload =
    body.mode === "isolate"
      ? {
          ...body,
          imageDataUrl: await compressImageDataUrl(body.imageDataUrl, {
            maxDim: 1024,
            preserveAlpha: false,
          }),
        }
      : body;
  return send<RenderedFrame>("POST", ROUTES.extract, payload, { signal });
}

export async function streamCampaignShoot(
  body: {
    product: ProductPayload;
    marketIds: string[];
    tier: HelioModelTier;
    customBrief?: string;
    moodReferenceDataUrl?: string;
  },
  onEvent: (event: ShootStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const [product, moodReferenceDataUrl] = await Promise.all([
    compressProductPayload(body.product),
    body.moodReferenceDataUrl
      ? compressImageDataUrl(body.moodReferenceDataUrl, {
          maxDim: 896,
          preserveAlpha: false,
        })
      : Promise.resolve(undefined),
  ]);
  await streamJson<ShootStreamEvent>(
    ROUTES.shoot,
    { ...body, product, moodReferenceDataUrl },
    onEvent,
    { signal },
  );
}

export async function postSurgicalEdit(
  body: {
    product: ProductPayload;
    baseImageDataUrl: string;
    marketId: string;
    instruction: string;
    tier: HelioModelTier;
    referenceImageDataUrl?: string;
  },
  signal?: AbortSignal,
): Promise<RenderedFrame> {
  const [product, baseImageDataUrl, referenceImageDataUrl] = await Promise.all([
    compressProductPayload(body.product),
    compressImageDataUrl(body.baseImageDataUrl, {
      maxDim: 1024,
      preserveAlpha: false,
    }),
    body.referenceImageDataUrl
      ? compressImageDataUrl(body.referenceImageDataUrl, {
          maxDim: 896,
          preserveAlpha: false,
        })
      : Promise.resolve(undefined),
  ]);
  return send<RenderedFrame>(
    "POST",
    ROUTES.edit,
    { ...body, product, baseImageDataUrl, referenceImageDataUrl },
    { signal },
  );
}

export async function postBrandAudit(
  body: {
    product: ProductPayload;
    stagedImageDataUrl: string;
    marketId: string;
    directionSummary?: string;
  },
  signal?: AbortSignal,
): Promise<BrandAuditResult> {
  const [product, stagedImageDataUrl] = await Promise.all([
    compressProductPayload(body.product),
    compressImageDataUrl(body.stagedImageDataUrl, {
      maxDim: 1024,
      preserveAlpha: false,
    }),
  ]);
  return send<BrandAuditResult>(
    "POST",
    ROUTES.audit,
    { ...body, product, stagedImageDataUrl },
    { signal },
  );
}

export async function streamTierCompare(
  body: {
    product: ProductPayload;
    marketId: string;
    customBrief?: string;
  },
  onEvent: (event: CompareStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const product = await compressProductPayload(body.product);
  await streamJson<CompareStreamEvent>(
    ROUTES.compare,
    { ...body, product },
    onEvent,
    { signal },
  );
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read file."));
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Loads any image URL / data URL onto a 160x160 HTML5 canvas to compute pure-code
 * pixel telemetry AND render a true Alpha-Channel X-Ray visualization data URL.
 */
export async function inspectImageInBrowser(src: string): Promise<{
  telemetry: OpticalTelemetry;
  alphaXrayDataUrl: string;
}> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode image."));
    el.src = src;
  });

  const sampleSize = 180;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable.");
  ctx.clearRect(0, 0, sampleSize, sampleSize);
  ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
  const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);

  const telemetry = analyzeRgbaPixels({
    data: imageData.data,
    width: sampleSize,
    height: sampleSize,
    sourceWidth: img.naturalWidth || sampleSize,
    sourceHeight: img.naturalHeight || sampleSize,
  });

  // Build Alpha X-Ray plate: transparent = deep blueprint ink, opaque interior = warm ivory,
  // semi-transparent anti-aliased fringe = radiant brass (#d9a84e).
  const xrayCanvas = document.createElement("canvas");
  xrayCanvas.width = sampleSize;
  xrayCanvas.height = sampleSize;
  const xCtx = xrayCanvas.getContext("2d");
  let alphaXrayDataUrl = "";
  if (xCtx) {
    const out = xCtx.createImageData(sampleSize, sampleSize);
    const srcBytes = imageData.data;
    const dst = out.data;
    for (let i = 0; i < srcBytes.length; i += 4) {
      const a = srcBytes[i + 3] ?? 255;
      if (a < 18) {
        // Transparent background -> deep blueprint dark
        dst[i] = 13;
        dst[i + 1] = 20;
        dst[i + 2] = 36;
        dst[i + 3] = 255;
      } else if (a < 235) {
        // Anti-aliased feather edge -> glowing brass contour!
        dst[i] = 217;
        dst[i + 1] = 168;
        dst[i + 2] = 78;
        dst[i + 3] = 255;
      } else {
        // Solid product mass -> subtle blueprint luminance topography
        const luma =
          0.2126 * (srcBytes[i] ?? 0) +
          0.7152 * (srcBytes[i + 1] ?? 0) +
          0.0722 * (srcBytes[i + 2] ?? 0);
        const shade = Math.round(185 + (luma / 255) * 65);
        dst[i] = shade;
        dst[i + 1] = Math.round(shade * 0.97);
        dst[i + 2] = Math.round(shade * 0.91);
        dst[i + 3] = 255;
      }
    }
    xCtx.putImageData(out, 0, 0);
    alphaXrayDataUrl = xrayCanvas.toDataURL("image/png");
  }

  return { telemetry, alphaXrayDataUrl };
}
