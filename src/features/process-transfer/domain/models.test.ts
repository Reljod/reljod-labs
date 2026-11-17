import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODELS,
  estimateCost,
  gatewayCost,
  modelsFor,
  resolveModels,
} from "./models";

describe("gatewayCost", () => {
  it("takes what the gateway charged", () => {
    expect(
      gatewayCost({ gateway: { cost: "0.0007395", marketCost: "0.0009" } }),
    ).toBe(0.0007395);
  });

  it("falls back to the list price when nothing was charged", () => {
    expect(
      gatewayCost({ gateway: { cost: "0", marketCost: "0.0000866" } }),
    ).toBe(0.0000866);
  });

  it("is null when the gateway says nothing usable, so the call is estimated", () => {
    expect(gatewayCost(undefined)).toBeNull();
    expect(gatewayCost({ gateway: {} })).toBeNull();
    expect(gatewayCost({ gateway: { cost: "0", marketCost: "0" } })).toBeNull();
    expect(gatewayCost({ gateway: { cost: "n/a" } })).toBeNull();
  });
});

describe("models", () => {
  it("estimates from list prices per million tokens", () => {
    expect(estimateCost("anthropic/claude-haiku-5.5", 4249, 7451)).toBeCloseTo(
      0.00415,
      5,
    );
    expect(estimateCost("acme/unknown", 1000, 1000)).toBe(0);
  });

  it("only lets a model that takes video Watch", () => {
    expect(modelsFor("watch")).not.toContain("anthropic/claude-haiku-5.5");
    expect(
      resolveModels({
        watch: "anthropic/claude-haiku-5.5",
        write: "anthropic/claude-sonnet-5.5",
        review: "nope",
      }),
    ).toEqual({ ...DEFAULT_MODELS, write: "anthropic/claude-sonnet-5.5" });
  });
});
