import { describe, expect, it } from "vitest";
import { clampUnit, lensTouches } from "./lens";

const box = { left: 100, top: 100, width: 50, height: 20 };

describe("lensTouches", () => {
  it("finds a spot under the lens's centre", () => {
    expect(lensTouches({ x: 120, y: 110, r: 5 }, box)).toBe(true);
  });

  it("finds a spot the rim overlaps", () => {
    expect(lensTouches({ x: 90, y: 110, r: 12 }, box)).toBe(true);
  });

  it("misses a spot just past the rim, corners included", () => {
    expect(lensTouches({ x: 90, y: 110, r: 9 }, box)).toBe(false);
    // 8 px right and 8 px below the corner is 11.3 px away.
    expect(lensTouches({ x: 158, y: 128, r: 11 }, box)).toBe(false);
    expect(lensTouches({ x: 158, y: 128, r: 12 }, box)).toBe(true);
  });
});

describe("clampUnit", () => {
  it("keeps values on the stage", () => {
    expect(clampUnit(-0.2)).toBe(0);
    expect(clampUnit(1.4)).toBe(1);
    expect(clampUnit(0.3)).toBe(0.3);
    expect(clampUnit(Number.NaN)).toBe(0.5);
  });
});
