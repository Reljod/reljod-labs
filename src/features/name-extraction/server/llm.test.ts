import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ env: { aiGatewayApiKey: () => "test" } }));
const recordCall = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./emit", () => ({ recordCall }));

const { callCost, gatewayCost, trackCall } = await import("./llm");

describe("call cost", () => {
  const haiku = "anthropic/claude-haiku-5.5";
  const tokens = { input: 23_483, output: 745, cached: 1_661 };

  it("takes the larger of the charged and the market cost", () => {
    expect(gatewayCost({ gateway: { cost: "0", marketCost: "0.0027" } })).toBe(
      0.0027,
    );
    expect(gatewayCost({ gateway: { cost: 0.01 } })).toBe(0.01);
    expect(gatewayCost({})).toBeNull();
  });

  it("estimates from the list price when the gateway reports 0 for a call that used tokens", () => {
    const cost = callCost(haiku, { gateway: { cost: "0" } }, tokens);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(
      ((23_483 - 1_661) * 0.1 + 1_661 * 0.01 + 745 * 0.5) / 1e6,
    );
  });

  it("keeps a reported 0 for a call with no tokens", () => {
    expect(
      callCost(
        haiku,
        { gateway: { cost: 0 } },
        { input: 0, output: 0, cached: 0 },
      ),
    ).toBe(0);
  });

  it("tracks a credit-paid call (cost 0, tokens used) at the list-price estimate", async () => {
    const event = await trackCall({
      runId: "run-1",
      purpose: "reader",
      model: haiku,
      usage: {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        inputTokenDetails: {
          cacheReadTokens: tokens.cached,
          cacheWriteTokens: 0,
          noCacheTokens: tokens.input - tokens.cached,
        },
      },
      providerMetadata: { gateway: { cost: "0" } },
      started: Date.now(),
    });
    const estimate = callCost(haiku, null, tokens);
    expect(estimate).toBeGreaterThan(0);
    expect(event).toMatchObject({
      type: "cost",
      purpose: "reader",
      model: haiku,
      costUsd: estimate,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cachedInputTokens: tokens.cached,
    });
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        costUsd: estimate,
        cachedInputTokens: tokens.cached,
      }),
    );
  });
});
