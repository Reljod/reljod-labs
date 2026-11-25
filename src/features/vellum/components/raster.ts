"use client";

/**
 * Pixels in the browser: the screenshot made ready to send, squared up with
 * the Sheet's grid, and a Drawing rasterized for the Ruler. Everything here
 * is canvas plumbing; the measuring itself is `domain/ruler.ts`.
 */
import type { Note } from "../domain/api";
import { type Drawing, SHEET_WIDTH, sheetHeight } from "../domain/drawing";
import { LIMITS } from "../domain/limits";
import { type Measurement, measure, worstCells } from "../domain/ruler";
import { drawingToSvg } from "../domain/svg";

/** The Ruler measures at this width; enough for text edges, quick in JS. */
export const MEASURE_WIDTH = 280;
/** Cells across the Ruler's grid. */
export const RULER_COLS = 20;

export type Screenshot = {
  /** Shown on the Stage. */
  src: string;
  width: number;
  height: number;
  sheetHeight: number;
  /** Sent to the model. */
  screenshot: string;
  squared: string;
  /** The screenshot at the Ruler's size. */
  pixels: ImageData;
};

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be read."));
    image.src = src;
  });
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot draw on a canvas.");
  return { canvas, context };
}

/** The largest JPEG quality that keeps the image under the server's cap. */
function encode(canvas: HTMLCanvasElement) {
  for (const quality of [0.9, 0.8, 0.7, 0.55]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if ((url.length * 3) / 4 < LIMITS.imageBytes * 0.95) return url;
  }
  throw new Error(
    "That screenshot is too detailed to send. Try a smaller one.",
  );
}

/**
 * Rules the Sheet's grid over the screenshot, the way an artist squares up a
 * picture to copy it: a fine line every 50 units, a labelled one every 100.
 */
function squareUp(
  image: HTMLImageElement,
  width: number,
  height: number,
  sheet: number,
) {
  const { canvas, context } = canvasOf(width, height);
  context.drawImage(image, 0, 0, width, height);
  const scale = width / SHEET_WIDTH;
  const font = Math.max(9, Math.round(11 * Math.max(1, scale)));
  context.font = `600 ${font}px ui-monospace, Menlo, monospace`;
  context.textBaseline = "top";
  for (let unit = 0; unit <= Math.max(SHEET_WIDTH, sheet); unit += 50) {
    const major = unit % 100 === 0;
    context.strokeStyle = major
      ? "rgba(255,0,170,0.75)"
      : "rgba(255,0,170,0.35)";
    context.lineWidth = major ? 1.25 : 0.75;
    const at = Math.round(unit * scale) + 0.5;
    if (unit <= SHEET_WIDTH) {
      context.beginPath();
      context.moveTo(at, 0);
      context.lineTo(at, height);
      context.stroke();
    }
    if (unit <= sheet) {
      context.beginPath();
      context.moveTo(0, at);
      context.lineTo(width, at);
      context.stroke();
    }
    if (!major || unit === 0) continue;
    const label = String(unit);
    context.lineWidth = 3;
    context.strokeStyle = "rgba(255,255,255,0.9)";
    context.fillStyle = "#c00080";
    if (unit < SHEET_WIDTH) {
      context.strokeText(label, at + 2, 2);
      context.fillText(label, at + 2, 2);
    }
    if (unit < sheet) {
      context.strokeText(label, 2, at + 2);
      context.fillText(label, 2, at + 2);
    }
  }
  return encode(canvas);
}

/** Any image (a Sample's path or an upload's object URL), made ready to trace. */
export async function prepareScreenshot(src: string): Promise<Screenshot> {
  const image = await loadImage(src);
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (naturalWidth < 64 || naturalHeight < 64)
    throw new Error("That image is too small to trace.");
  const ratio = naturalHeight / naturalWidth;
  if (ratio > 4 || ratio < 0.25)
    throw new Error("That image is too long and thin. Crop it to one screen.");
  const shrink = Math.min(
    1,
    LIMITS.imageSide / Math.max(naturalWidth, naturalHeight),
  );
  const width = Math.max(16, Math.round(naturalWidth * shrink));
  const height = Math.max(16, Math.round(naturalHeight * shrink));
  const sheet = sheetHeight(width, height);

  const plain = canvasOf(width, height);
  plain.context.drawImage(image, 0, 0, width, height);

  const small = canvasOf(MEASURE_WIDTH, measureHeight(sheet));
  small.context.imageSmoothingQuality = "high";
  small.context.drawImage(image, 0, 0, small.canvas.width, small.canvas.height);

  return {
    src,
    width,
    height,
    sheetHeight: sheet,
    screenshot: encode(plain.canvas),
    squared: squareUp(image, width, height, sheet),
    pixels: small.context.getImageData(
      0,
      0,
      small.canvas.width,
      small.canvas.height,
    ),
  };
}

export const measureHeight = (sheet: number) =>
  Math.max(8, Math.round((MEASURE_WIDTH * sheet) / SHEET_WIDTH));

async function drawingImage(drawing: Drawing, scale: number) {
  const svg = drawingToSvg(drawing, scale);
  return loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
}

/** The Drawing measured against the screenshot by the Ruler. */
export async function measureDrawing(
  drawing: Drawing,
  original: ImageData,
): Promise<Measurement> {
  const image = await drawingImage(drawing, MEASURE_WIDTH / SHEET_WIDTH);
  const { canvas, context } = canvasOf(original.width, original.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const drawn = context.getImageData(0, 0, canvas.width, canvas.height);
  return measure(original, drawn, { cols: RULER_COLS });
}

/** The Drawing as code rendered it, the size of the screenshot sent, for the next Pass. */
export async function renderingOf(drawing: Drawing, width: number) {
  const image = await drawingImage(drawing, width / SHEET_WIDTH);
  const { canvas, context } = canvasOf(
    width,
    Math.round((width * drawing.height) / SHEET_WIDTH),
  );
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return encode(canvas);
}

/** The Ruler's worst Cells, in Sheet units, for the next Pass's brief. */
export function notesFrom(measurement: Measurement, below: number): Note[] {
  const toSheet = SHEET_WIDTH / measurement.width;
  return worstCells(measurement, below, LIMITS.notes).map((cell) => ({
    x: Math.round(cell.x * toSheet),
    y: Math.round(cell.y * toSheet),
    w: Math.max(1, Math.round(cell.w * toSheet)),
    h: Math.max(1, Math.round(cell.h * toSheet)),
    original: cell.original,
    drawn: cell.drawn,
    likeness: Math.round(cell.likeness * 1000) / 1000,
  }));
}

/** The Drawing as an SVG file to save. */
export function svgFileOf(drawing: Drawing) {
  return new Blob([drawingToSvg(drawing)], { type: "image/svg+xml" });
}
