import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { actionOf, callCost, callOf } from "./operator";

describe("tool calls and Actions", () => {
  it("turns a screen tool call into an Action and back", () => {
    const wanted = actionOf("screen_key", { keys: ["Tab", "F10"] });
    expect(wanted).toEqual({ action: { type: "key", keys: ["Tab", "F10"] } });
    if ("action" in wanted)
      expect(callOf(wanted.action, "c1")).toEqual({
        toolCallId: "c1",
        toolName: "screen_key",
        input: { keys: ["Tab", "F10"] },
      });
    expect(actionOf("screen_scroll", { direction: "up" })).toEqual({
      action: { type: "scroll", dy: -400 },
    });
  });

  it("refuses a key that is not on the list, and a click off the Screen", () => {
    expect(actionOf("screen_key", { keys: ["Control+L"] })).toHaveProperty(
      "error",
    );
    expect(actionOf("screen_click", { x: 5000, y: 10 })).toHaveProperty(
      "error",
    );
    expect(actionOf("screen_type", { text: "café" })).toHaveProperty("error");
    expect(actionOf("navigate", { url: "x" })).toHaveProperty("error");
  });
});

describe("what a model call cost", () => {
  const tokens = { input: 10_000, output: 500, cached: 8_000 };
  it("takes the gateway's figure when it reports one", () => {
    expect(
      callCost(
        "anthropic/claude-sonnet-5.5",
        { gateway: { cost: "0", marketCost: "0.0123" } },
        tokens,
      ),
    ).toBe(0.0123);
  });
  it("falls back to the list price, cache reads included", () => {
    // 2,000 fresh at $2, 8,000 cached at $0.10, 500 out at $10, per million.
    expect(
      callCost("anthropic/claude-sonnet-5.5", undefined, tokens),
    ).toBeCloseTo(0.004 + 0.0008 + 0.005, 6);
  });
});
