import type { OpticalTelemetry } from "./types";

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${clampByte(r).toString(16).padStart(2, "0")}${clampByte(g).toString(16).padStart(2, "0")}${clampByte(b).toString(16).padStart(2, "0")}`;
}

/**
 * Pure deterministic pixel telemetry over an RGBA buffer (browser Canvas ImageData
 * or test buffer). Zero AI hallucination: measures alpha cutout cleanliness,
 * dominant quantized palette, 16-bin luminance histogram, RMS contrast,
 * highlight clipping, and Sobel edge sharpness.
 */
export function analyzeRgbaPixels(input: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
}): OpticalTelemetry {
  const { data, width, height } = input;
  const totalPixels = Math.max(1, width * height);
  const bins = new Array<number>(16).fill(0);
  const colorBuckets = new Map<
    number,
    { count: number; rSum: number; gSum: number; bSum: number }
  >();

  let transparentCount = 0;
  let opaqueCount = 0;
  let lumSum = 0;
  let lumSqSum = 0;
  let highlightClipCount = 0;

  const luma = new Float32Array(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    const r = data[off] ?? 0;
    const g = data[off + 1] ?? 0;
    const b = data[off + 2] ?? 0;
    const a = data[off + 3] ?? 255;

    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = y;

    if (a < 245) {
      transparentCount++;
    } else {
      opaqueCount++;
      lumSum += y;
      lumSqSum += y * y;
      if (y > 250) highlightClipCount++;
      const binIdx = Math.min(15, Math.floor((y / 256) * 16));
      bins[binIdx] = (bins[binIdx] ?? 0) + 1;

      // 4-bit per channel quantization for dominant swatches
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = colorBuckets.get(key);
      if (bucket) {
        bucket.count++;
        bucket.rSum += r;
        bucket.gSum += g;
        bucket.bSum += b;
      } else {
        colorBuckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
      }
    }
  }

  const denom = Math.max(1, opaqueCount);
  const meanLuminance = lumSum / denom;
  const variance = Math.max(
    0,
    lumSqSum / denom - meanLuminance * meanLuminance,
  );
  const stdDev = Math.sqrt(variance);
  const contrastIndex = Math.min(100, Math.round((stdDev / 92) * 100));

  const maxBin = Math.max(1, ...bins);
  const histogram = bins.map((count) => Number((count / maxBin).toFixed(3)));

  // Pick 5 visually distinct dominant swatches
  const sortedBuckets = [...colorBuckets.values()].sort(
    (a, b) => b.count - a.count,
  );
  const pickedRgb: Array<[number, number, number]> = [];
  for (const bucket of sortedBuckets) {
    if (pickedRgb.length >= 5) break;
    const r = bucket.rSum / bucket.count;
    const g = bucket.gSum / bucket.count;
    const b = bucket.bSum / bucket.count;
    const tooClose = pickedRgb.some(
      ([pr, pg, pb]) => Math.hypot(r - pr, g - pg, b - pb) < 42,
    );
    if (!tooClose) {
      pickedRgb.push([r, g, b]);
    }
  }
  const palette = pickedRgb.map(([r, g, b]) => rgbToHex(r, g, b));

  // Sobel gradient magnitude on interior pixels for objective edge sharpness
  let gradSum = 0;
  let gradSamples = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = y * width + x;
      const a = data[idx * 4 + 3] ?? 255;
      if (a < 245) continue;
      const tl = luma[idx - width - 1] ?? 0;
      const t = luma[idx - width] ?? 0;
      const tr = luma[idx - width + 1] ?? 0;
      const l = luma[idx - 1] ?? 0;
      const r = luma[idx + 1] ?? 0;
      const bl = luma[idx + width - 1] ?? 0;
      const b = luma[idx + width] ?? 0;
      const br = luma[idx + width + 1] ?? 0;
      const gx = -tl + tr - 2 * l + 2 * r - bl + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      gradSum += Math.hypot(gx, gy);
      gradSamples++;
    }
  }
  const avgGrad = gradSamples > 0 ? gradSum / gradSamples : 0;
  const sharpnessIndex = Math.min(100, Math.round((avgGrad / 95) * 100));

  const outWidth = input.sourceWidth ?? width;
  const outHeight = input.sourceHeight ?? height;

  return {
    width: outWidth,
    height: outHeight,
    transparentPct: Number(((transparentCount / totalPixels) * 100).toFixed(1)),
    palette: palette.length > 0 ? palette : ["#14213d", "#d9a84e", "#f5f1e8"],
    histogram,
    meanLuminance: Math.round(meanLuminance),
    contrastIndex,
    sharpnessIndex,
    highlightClipPct: Number(((highlightClipCount / denom) * 100).toFixed(1)),
    printReady: outWidth >= 1024 && outHeight >= 1024,
  };
}
