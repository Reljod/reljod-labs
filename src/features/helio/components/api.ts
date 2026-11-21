"use client";

import { analyzeRgbaPixels } from "../domain/telemetry";
import type {
  BrandAuditResult,
  CompareStreamEvent,
  HelioModelTier,
  OpticalTelemetry,
  ShootStreamEvent,
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

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      return text.trim().slice(0, 200);
    }
  }
  return `Request failed (${response.status})`;
}

async function readNdjson<T>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!response.body) throw new Error("Empty response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) {
        onEvent(JSON.parse(line) as T);
      }
      newlineIdx = buffer.indexOf("\n");
    }
  }
  const rest = buffer.trim();
  if (rest) {
    onEvent(JSON.parse(rest) as T);
  }
}

export async function postExtractPlate(
  body:
    | { mode: "isolate"; imageDataUrl: string; productName?: string }
    | { mode: "synthesize"; concept: string; productName?: string },
  signal?: AbortSignal,
): Promise<{
  imageDataUrl: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}> {
  const response = await fetch("/api/helio/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as {
    imageDataUrl: string;
    model: string;
    latencyMs: number;
    costUsd: number;
  };
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
  const response = await fetch("/api/helio/shoot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  await readNdjson<ShootStreamEvent>(response, onEvent);
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
): Promise<{
  imageDataUrl: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}> {
  const response = await fetch("/api/helio/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as {
    imageDataUrl: string;
    model: string;
    latencyMs: number;
    costUsd: number;
  };
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
  const response = await fetch("/api/helio/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as BrandAuditResult;
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
  const response = await fetch("/api/helio/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  await readNdjson<CompareStreamEvent>(response, onEvent);
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
