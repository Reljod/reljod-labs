import { describe, expect, it } from "vitest";
import { colourDistance, measure, type Pixels, worstCells } from "./ruler";

function raster(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  return { width, height, data };
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLUE: [number, number, number] = [29, 78, 137];
const INK: [number, number, number] = [20, 33, 61];

/** A white screen with a blue header and a few lines of "text". */
const screen = (shiftText = 0, header = BLUE) =>
  raster(64, 48, (x, y) => {
    if (y < 10) return header;
    if (
      y >= 20 &&
      y < 40 &&
      y % 4 < 2 &&
      x >= 8 + shiftText &&
      x < 50 + shiftText
    )
      return INK;
    return WHITE;
  });

describe("the Ruler", () => {
  it("scores a raster against itself as a perfect likeness", () => {
    const m = measure(screen(), screen(), { cols: 8 });
    expect(m.likeness).toBeCloseTo(1, 6);
    expect(m.colour).toBeCloseTo(1, 6);
    expect(m.structure).toBeCloseTo(1, 6);
    expect(m.cols).toBe(8);
    expect(m.rows).toBe(6);
    expect(m.cells).toHaveLength(48);
  });

  it("scores a wrong colour lower in colour, and only where it is wrong", () => {
    const m = measure(screen(), screen(0, [178, 58, 43]), { cols: 8 });
    expect(m.likeness).toBeLessThan(0.95);
    const header = m.cells.filter((cell) => cell.row === 0);
    const body = m.cells.filter((cell) => cell.row >= 2);
    expect(Math.max(...header.map((cell) => cell.colour))).toBeLessThan(0.5);
    expect(Math.min(...body.map((cell) => cell.likeness))).toBeCloseTo(1, 6);
    expect(header[0]?.original).toBe("#1d4e89");
    expect(header[0]?.drawn).toBe("#b23a2b");
  });

  it("notices text in the wrong place through structure, not only colour", () => {
    const shifted = measure(screen(), screen(6), { cols: 8 });
    const blank = measure(
      screen(),
      raster(64, 48, (_x, y) => (y < 10 ? BLUE : WHITE)),
      { cols: 8 },
    );
    expect(shifted.structure).toBeLessThan(1);
    expect(blank.likeness).toBeLessThan(shifted.likeness + 0.05);
    expect(blank.likeness).toBeLessThan(0.95);
  });

  it("ranks the worst cells first, and only those below the bar", () => {
    const m = measure(screen(), screen(0, [178, 58, 43]), { cols: 8 });
    const worst = worstCells(m, 0.9, 3);
    expect(worst).toHaveLength(3);
    expect(worst.every((cell) => cell.row === 0)).toBe(true);
    expect(worstCells(m, 0, 3)).toEqual([]);
  });

  it("refuses rasters of different sizes", () => {
    expect(() =>
      measure(
        screen(),
        raster(10, 10, () => WHITE),
      ),
    ).toThrow();
  });

  it("measures colour distance from 0 to 1", () => {
    expect(colourDistance(10, 20, 30, 10, 20, 30)).toBe(0);
    expect(colourDistance(0, 0, 0, 255, 255, 255)).toBeCloseTo(1, 2);
  });
});
