import { describe, expect, it } from "vitest";
import type { Deck, ImageElement, Slide } from "../domain/deck";
import { SAMPLE_PROCESS } from "../domain/test-fixtures";
import { fitWidth, frameTimes, missingTimes, seekTime } from "./frame-times";

const image = (frameAt: number): ImageElement => ({
  id: `img-${frameAt}`,
  role: "screenshot",
  type: "image",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  animation: null,
  frameAt,
  alt: "",
});

const slide = (elements: Slide["elements"]): Slide => ({
  id: "x",
  planId: "p1",
  kind: "step",
  stepId: null,
  background: "#ffffff",
  transition: { type: "fade", durationMs: 300 },
  elements,
  notes: "",
});

const deck = (slides: Slide[]): Deck =>
  ({ title: "t", theme: {} as Deck["theme"], slides }) as Deck;

describe("frameTimes", () => {
  it("collects step and screenshot times once each, in order", () => {
    const process = {
      steps: [
        { ...SAMPLE_PROCESS.steps[0], at: 42 },
        { ...SAMPLE_PROCESS.steps[1], at: 12.04 },
      ],
    };
    const rounds = [
      { deck: deck([slide([image(42.01), image(80)])]) },
      { deck: deck([slide([image(80)])]) },
    ];
    expect(frameTimes(process, rounds)).toEqual([12, 42, 80]);
  });

  it("drops times past the end of the Recording", () => {
    const process = { steps: [{ ...SAMPLE_PROCESS.steps[0], at: 900 }] };
    expect(frameTimes(process, [], 120)).toEqual([]);
    expect(frameTimes(null, [])).toEqual([]);
  });
});

describe("missingTimes", () => {
  it("skips Frames already captured", () => {
    expect(missingTimes([12, 42], { "12.0": 1 })).toEqual([42]);
  });
});

describe("fitWidth and seekTime", () => {
  it("scales down only", () => {
    expect(fitWidth(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitWidth(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });

  it("stays inside the video", () => {
    expect(seekTime(130, 120)).toBeCloseTo(119.95);
    expect(seekTime(-3, 120)).toBe(0);
    expect(seekTime(10, Number.NaN)).toBe(10);
  });
});
