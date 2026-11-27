import { describe, expect, it } from "vitest";
import { ACTION_LIMITS, screenActionSchema } from "./actions";
import { frameSrc } from "./api";
import {
  DEFAULT_MODEL,
  estimateCost,
  handInputSchema,
  isOver,
  MODELS,
  taskRefSchema,
} from "./contract";

const ok =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (value: unknown) =>
    schema.safeParse(value).success;

describe("estimateCost", () => {
  it("prices fresh input, cached input and output per million tokens", () => {
    // Sonnet: 2 in, 10 out, 0.1 cached.
    expect(
      estimateCost("anthropic/claude-sonnet-5.5", 1_000_000, 0, 0),
    ).toBeCloseTo(2);
    expect(
      estimateCost("anthropic/claude-sonnet-5.5", 0, 1_000_000, 0),
    ).toBeCloseTo(10);
    expect(
      estimateCost("anthropic/claude-sonnet-5.5", 1_000_000, 0, 1_000_000),
    ).toBeCloseTo(0.1);
    expect(
      estimateCost("anthropic/claude-sonnet-5.5", 300_000, 50_000, 200_000),
    ).toBeCloseTo((100_000 * 2 + 200_000 * 0.1 + 50_000 * 10) / 1_000_000);
  });

  it("prices cached tokens lower than fresh ones", () => {
    const fresh = estimateCost("anthropic/claude-haiku-5.5", 10_000, 0, 0);
    const cached = estimateCost(
      "anthropic/claude-haiku-5.5",
      10_000,
      0,
      10_000,
    );
    expect(cached).toBeLessThan(fresh);
    expect(fresh).toBeCloseTo((10_000 * 0.1) / 1_000_000);
  });

  it("falls back to the default model's price for an unknown model", () => {
    expect(estimateCost("someone/else", 1000, 1000, 0)).toBe(
      estimateCost(DEFAULT_MODEL, 1000, 1000, 0),
    );
  });

  it("never prices negative fresh input", () => {
    const price = MODELS[DEFAULT_MODEL];
    expect(estimateCost(DEFAULT_MODEL, 100, 0, 500)).toBeCloseTo(
      (500 * price.cachedInput) / 1_000_000,
    );
  });
});

describe("isOver", () => {
  it("is true only for the three ends", () => {
    expect(isOver("completed")).toBe(true);
    expect(isOver("failed")).toBe(true);
    expect(isOver("stopped")).toBe(true);
    expect(isOver("queued")).toBe(false);
    expect(isOver("running")).toBe(false);
    expect(isOver("paused")).toBe(false);
  });
});

describe("taskRefSchema", () => {
  const valid = ok(taskRefSchema);
  it("accepts a sample by id and an own brief", () => {
    expect(valid({ kind: "sample", taskId: "arrival-corvina" })).toBe(true);
    expect(valid({ kind: "own", brief: "Register a vessel." })).toBe(true);
  });
  it("refuses empty, over-long and unknown kinds", () => {
    expect(valid({ kind: "sample", taskId: "" })).toBe(false);
    expect(valid({ kind: "sample", taskId: "x".repeat(61) })).toBe(false);
    expect(valid({ kind: "own", brief: "" })).toBe(false);
    expect(valid({ kind: "own", brief: "x".repeat(4001) })).toBe(false);
    expect(valid({ kind: "own", brief: "x".repeat(4000) })).toBe(true);
    expect(valid({ kind: "other", brief: "x" })).toBe(false);
    expect(valid({ kind: "own" })).toBe(false);
  });
});

describe("handInputSchema", () => {
  const valid = ok(handInputSchema);
  it("accepts a timed Action", () => {
    expect(valid({ at: 0, action: { type: "key", keys: ["Enter"] } })).toBe(
      true,
    );
    expect(
      valid({ at: 3_600_000, action: { type: "type", text: "OPR7" } }),
    ).toBe(true);
  });
  it("refuses a bad time or a bad Action", () => {
    expect(valid({ at: -1, action: { type: "key", keys: ["Enter"] } })).toBe(
      false,
    );
    expect(
      valid({ at: 3_600_001, action: { type: "key", keys: ["Enter"] } }),
    ).toBe(false);
    expect(valid({ at: 1.5, action: { type: "key", keys: ["Enter"] } })).toBe(
      false,
    );
    expect(valid({ at: 0, action: { type: "key", keys: ["Meta"] } })).toBe(
      false,
    );
  });
});

describe("screenActionSchema", () => {
  const valid = ok(screenActionSchema);

  it("accepts each kind of Action", () => {
    expect(valid({ type: "click", x: 0, y: 0 })).toBe(true);
    expect(valid({ type: "click", x: 1023, y: 639 })).toBe(true);
    expect(valid({ type: "type", text: "MRDU4821131" })).toBe(true);
    expect(valid({ type: "key", keys: ["Shift+Tab", "F10"] })).toBe(true);
    expect(valid({ type: "scroll", dy: -200 })).toBe(true);
    expect(valid({ type: "wait", ms: 500 })).toBe(true);
  });

  it("refuses non-printable or over-long text", () => {
    expect(valid({ type: "type", text: "OPR7\n" })).toBe(false);
    expect(valid({ type: "type", text: "OPR7\t" })).toBe(false);
    expect(valid({ type: "type", text: "\u001b[2J" })).toBe(false);
    expect(valid({ type: "type", text: "CAFÉ" })).toBe(false);
    expect(valid({ type: "type", text: "" })).toBe(false);
    expect(
      valid({ type: "type", text: "A".repeat(ACTION_LIMITS.typeChars) }),
    ).toBe(true);
    expect(
      valid({ type: "type", text: "A".repeat(ACTION_LIMITS.typeChars + 1) }),
    ).toBe(false);
  });

  it("refuses too many keys, no keys and an unknown key", () => {
    expect(
      valid({
        type: "key",
        keys: Array(ACTION_LIMITS.keysPerAction).fill("Tab"),
      }),
    ).toBe(true);
    expect(
      valid({
        type: "key",
        keys: Array(ACTION_LIMITS.keysPerAction + 1).fill("Tab"),
      }),
    ).toBe(false);
    expect(valid({ type: "key", keys: [] })).toBe(false);
    expect(valid({ type: "key", keys: ["Control+C"] })).toBe(false);
    expect(valid({ type: "key", keys: ["a"] })).toBe(false);
  });

  it("refuses a click outside 1024 by 640", () => {
    expect(valid({ type: "click", x: 1024, y: 0 })).toBe(false);
    expect(valid({ type: "click", x: 0, y: 640 })).toBe(false);
    expect(valid({ type: "click", x: -1, y: 0 })).toBe(false);
    expect(valid({ type: "click", x: 10.5, y: 0 })).toBe(false);
  });

  it("refuses a wait out of range and an unknown type", () => {
    expect(valid({ type: "wait", ms: 99 })).toBe(false);
    expect(valid({ type: "wait", ms: ACTION_LIMITS.waitMs + 1 })).toBe(false);
    expect(valid({ type: "drag", x: 0, y: 0 })).toBe(false);
  });
});

describe("frameSrc", () => {
  it("serves a recorded Run's Frame as a static file", () => {
    expect(
      frameSrc({ id: "r1", taskId: "arrival-corvina", replay: true }, 3),
    ).toBe("/operator/replays/arrival-corvina/frames/3.webp");
  });

  it("serves an owned Run's Frame through the gated route", () => {
    expect(frameSrc({ id: "r 1", taskId: "arrival-corvina" }, 0)).toBe(
      "/api/operator/runs/r%201/frames/0",
    );
    expect(
      frameSrc({ id: "r1", taskId: "arrival-corvina", replay: false }, 2),
    ).toBe("/api/operator/runs/r1/frames/2");
    // A replay without a Task id cannot be a static file.
    expect(frameSrc({ id: "r1", taskId: null, replay: true }, 2)).toBe(
      "/api/operator/runs/r1/frames/2",
    );
  });
});
