import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ env: { aiGatewayApiKey: () => "test" } }));
vi.mock("./emit", () => ({ runSink: () => ({ modelCall: async () => {} }) }));

const { callCost, gatewayCost } = await import("./llm");

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
});
