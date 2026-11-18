import { describe, expect, it } from "vitest";
import { mix, seg, splitFigure, stagger, within } from "./scroll-math";

describe("scroll math", () => {
  it("writes a clamped window of the progress variable", () => {
    expect(seg(0.2, 0.5)).toBe("clamp(0, (var(--p) - 0.2) / 0.3, 1)");
    expect(seg(0, 1, "--q")).toBe("clamp(0, (var(--q) - 0) / 1, 1)");
    expect(() => seg(0.5, 0.5)).toThrow();
  });

  it("mixes two values in one unit", () => {
    expect(mix(10, -30, "t", "px")).toBe("calc(10px + (-40px) * t)");
  });

  it("staggers windows so the last one ends at 1", () => {
    const starts = stagger(5, 0.2);
    expect(starts[0]).toBe(0);
    expect(starts.at(-1)).toBeCloseTo(0.8);
    expect(stagger(1, 0.3)).toEqual([0]);
  });

  it("maps a sub-window onto the chapter", () => {
    expect(within(0.2, 0.6, 0.5)).toBe(0.4);
  });

  it("splits a figure around its first number", () => {
    expect(splitFigure("7 yrs")).toEqual({
      before: "",
      value: 7,
      after: " yrs",
    });
    expect(splitFigure("95–97%")).toEqual({
      before: "",
      value: 95,
      after: "–97%",
    });
    expect(splitFigure("none")).toBeNull();
  });
});
