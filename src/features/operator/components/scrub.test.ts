import { describe, expect, it } from "vitest";
import {
  catchUpMs,
  clampIndex,
  DWELL,
  dwellMs,
  fitScale,
  stepIndex,
} from "./scrub";

describe("clampIndex and stepIndex", () => {
  it("stay inside the Frames", () => {
    expect(clampIndex(-3, 10)).toBe(0);
    expect(clampIndex(99, 10)).toBe(9);
    expect(clampIndex(4.6, 10)).toBe(5);
    expect(clampIndex(2, 0)).toBe(0);
    expect(clampIndex(Number.NaN, 10)).toBe(0);
    expect(stepIndex(0, -1, 10)).toBe(0);
    expect(stepIndex(9, 1, 10)).toBe(9);
    expect(stepIndex(3, 1, 10)).toBe(4);
  });
});

describe("dwellMs", () => {
  const frames = [{ at: 0 }, { at: 100 }, { at: 900 }, { at: 30_900 }];

  it("follows the recorded gap between a floor and a ceiling", () => {
    expect(dwellMs(frames, 0, 1)).toBe(DWELL.min);
    expect(dwellMs(frames, 1, 1)).toBe(800);
    expect(dwellMs(frames, 2, 1)).toBe(DWELL.max);
  });

  it("divides by the speed and has a fallback for the last Frame", () => {
    expect(dwellMs(frames, 1, 2)).toBe(400);
    expect(dwellMs(frames, 1, 4)).toBe(200);
    expect(dwellMs(frames, 3, 1)).toBe(DWELL.fallback);
    expect(dwellMs([], 0, 1)).toBe(DWELL.fallback);
  });
});

describe("catchUpMs", () => {
  it("hurries when the screen is far behind", () => {
    expect(catchUpMs(1)).toBeGreaterThan(catchUpMs(3));
    expect(catchUpMs(3)).toBeGreaterThan(catchUpMs(12));
  });
});

describe("fitScale", () => {
  it("scales the Screen to the element, and is 0 before it is measured", () => {
    expect(fitScale(512, 1024)).toBe(0.5);
    expect(fitScale(0, 1024)).toBe(0);
  });
});
