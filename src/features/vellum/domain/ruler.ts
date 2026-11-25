/**
 * The Ruler: how close a Drawing is to its screenshot, measured by code.
 *
 * The model draws; only this file scores. It compares two RGBA rasters of the
 * same size, the screenshot and the Drawing as rendered, and answers with a
 * Likeness for the whole Sheet and one for every Cell of a grid:
 *
 * - Colour: one minus the mean "redmean" colour distance, scaled so that a
 *   mean distance of `COLOUR_SPAN` (a different colour altogether) is 0.
 * - Structure: SSIM on luma over 8×8 windows (stride 4), clamped to 0..1, so
 *   edges, text and alignment count, not only flat colour.
 *
 * Likeness is the mean of the two. Pure: no DOM, no clock, no randomness.
 */

export type Pixels = {
  width: number;
  height: number;
  /** RGBA, row by row, as `ImageData.data`. */
  data: ArrayLike<number>;
};

export type Cell = {
  col: number;
  row: number;
  /** In raster pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  likeness: number;
  colour: number;
  structure: number;
  /** Mean colour of the screenshot here, `#rrggbb`. */
  original: string;
  /** Mean colour of the Drawing here. */
  drawn: string;
};

export type Measurement = {
  likeness: number;
  colour: number;
  structure: number;
  cols: number;
  rows: number;
  /** Raster size the Measurement was taken at. */
  width: number;
  height: number;
  cells: Cell[];
};

/** A mean colour distance this large scores 0 for Colour. */
export const COLOUR_SPAN = 0.35;
const WINDOW = 8;
const STRIDE = 4;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
/** The largest redmean distance, between black and white. */
const MAX_DISTANCE = Math.sqrt(3 * 255 ** 2 * 3);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")}`;

/** Redmean colour distance, 0 (same) to 1 (black against white). */
export function colourDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
) {
  const mean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (
    Math.sqrt(
      (2 + mean / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - mean) / 256) * db * db,
    ) / MAX_DISTANCE
  );
}

function luma(pixels: Pixels): Float32Array {
  const out = new Float32Array(pixels.width * pixels.height);
  const { data } = pixels;
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] =
      0.299 * (data[o] ?? 0) +
      0.587 * (data[o + 1] ?? 0) +
      0.114 * (data[o + 2] ?? 0);
  }
  return out;
}

/** SSIM of one window of two luma planes. */
function windowSsim(
  a: Float32Array,
  b: Float32Array,
  width: number,
  left: number,
  top: number,
) {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  for (let y = top; y < top + WINDOW; y++) {
    for (let x = left; x < left + WINDOW; x++) {
      const va = a[y * width + x] ?? 0;
      const vb = b[y * width + x] ?? 0;
      sumA += va;
      sumB += vb;
      sumAA += va * va;
      sumBB += vb * vb;
      sumAB += va * vb;
    }
  }
  const n = WINDOW * WINDOW;
  const meanA = sumA / n;
  const meanB = sumB / n;
  const varA = sumAA / n - meanA * meanA;
  const varB = sumBB / n - meanB * meanB;
  const cov = sumAB / n - meanA * meanB;
  return (
    ((2 * meanA * meanB + C1) * (2 * cov + C2)) /
    ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2))
  );
}

/**
 * Measures `drawn` against `original`, on a grid `cols` Cells wide (square
 * Cells; the last row and column may be partial).
 */
export function measure(
  original: Pixels,
  drawn: Pixels,
  options: { cols?: number } = {},
): Measurement {
  const { width, height } = original;
  if (drawn.width !== width || drawn.height !== height)
    throw new Error("The Ruler compares two rasters of the same size.");
  if (width < WINDOW || height < WINDOW)
    throw new Error("The raster is too small to measure.");

  const cols = Math.max(1, Math.round(options.cols ?? 16));
  const size = width / cols;
  const rows = Math.max(1, Math.ceil(height / size));
  const cellCount = cols * rows;
  const cellOf = (x: number, y: number) =>
    Math.min(rows - 1, Math.floor(y / size)) * cols +
    Math.min(cols - 1, Math.floor(x / size));

  const distance = new Float64Array(cellCount);
  const pixels = new Float64Array(cellCount);
  const sumsA = new Float64Array(cellCount * 3);
  const sumsB = new Float64Array(cellCount * 3);
  const a = original.data;
  const b = drawn.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const cell = cellOf(x, y);
      const r1 = a[o] ?? 0;
      const g1 = a[o + 1] ?? 0;
      const b1 = a[o + 2] ?? 0;
      const r2 = b[o] ?? 0;
      const g2 = b[o + 1] ?? 0;
      const b2 = b[o + 2] ?? 0;
      distance[cell] =
        (distance[cell] ?? 0) + colourDistance(r1, g1, b1, r2, g2, b2);
      pixels[cell] = (pixels[cell] ?? 0) + 1;
      sumsA[cell * 3] = (sumsA[cell * 3] ?? 0) + r1;
      sumsA[cell * 3 + 1] = (sumsA[cell * 3 + 1] ?? 0) + g1;
      sumsA[cell * 3 + 2] = (sumsA[cell * 3 + 2] ?? 0) + b1;
      sumsB[cell * 3] = (sumsB[cell * 3] ?? 0) + r2;
      sumsB[cell * 3 + 1] = (sumsB[cell * 3 + 1] ?? 0) + g2;
      sumsB[cell * 3 + 2] = (sumsB[cell * 3 + 2] ?? 0) + b2;
    }
  }

  const lumaA = luma(original);
  const lumaB = luma(drawn);
  const ssimSum = new Float64Array(cellCount);
  const ssimCount = new Float64Array(cellCount);
  for (let top = 0; top + WINDOW <= height; top += STRIDE) {
    for (let left = 0; left + WINDOW <= width; left += STRIDE) {
      const cell = cellOf(left + WINDOW / 2, top + WINDOW / 2);
      ssimSum[cell] =
        (ssimSum[cell] ?? 0) +
        clamp01(windowSsim(lumaA, lumaB, width, left, top));
      ssimCount[cell] = (ssimCount[cell] ?? 0) + 1;
    }
  }

  const cells: Cell[] = [];
  let weighted = 0;
  let colourWeighted = 0;
  let structureWeighted = 0;
  let total = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const count = pixels[index] ?? 0;
      if (count === 0) continue;
      const colour = clamp01(1 - (distance[index] ?? 0) / count / COLOUR_SPAN);
      const windows = ssimCount[index] ?? 0;
      // A sliver too thin for a window takes its colour score for structure too.
      const structure = windows > 0 ? (ssimSum[index] ?? 0) / windows : colour;
      const likeness = (colour + structure) / 2;
      const x = Math.round(col * size);
      const y = Math.round(row * size);
      cells.push({
        col,
        row,
        x,
        y,
        w: Math.min(width, Math.round((col + 1) * size)) - x,
        h: Math.min(height, Math.round((row + 1) * size)) - y,
        likeness,
        colour,
        structure,
        original: toHex(
          (sumsA[index * 3] ?? 0) / count,
          (sumsA[index * 3 + 1] ?? 0) / count,
          (sumsA[index * 3 + 2] ?? 0) / count,
        ),
        drawn: toHex(
          (sumsB[index * 3] ?? 0) / count,
          (sumsB[index * 3 + 1] ?? 0) / count,
          (sumsB[index * 3 + 2] ?? 0) / count,
        ),
      });
      weighted += likeness * count;
      colourWeighted += colour * count;
      structureWeighted += structure * count;
      total += count;
    }
  }
  return {
    likeness: weighted / total,
    colour: colourWeighted / total,
    structure: structureWeighted / total,
    cols,
    rows,
    width,
    height,
    cells,
  };
}

/** The `count` worst Cells below `below`, worst first. */
export function worstCells(
  measurement: Measurement,
  below: number,
  count: number,
): Cell[] {
  return measurement.cells
    .filter((cell) => cell.likeness < below)
    .sort((a, b) => a.likeness - b.likeness || a.row - b.row || a.col - b.col)
    .slice(0, count);
}

/** A share as a whole percentage, the way the page shows it. */
export const percent = (share: number) =>
  `${Math.round(clamp01(share) * 100)}%`;
