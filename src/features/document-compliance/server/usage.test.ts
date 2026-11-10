import type { LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";
import { readUsage } from "./usage";

const usage: LanguageModelUsage = {
  inputTokens: 2400,
  inputTokenDetails: {
    noCacheTokens: 2000,
    cacheReadTokens: 400,
    cacheWriteTokens: 0,
  },
  outputTokens: 310,
  outputTokenDetails: { textTokens: 250, reasoningTokens: 60 },
  totalTokens: 2710,
};

describe("readUsage", () => {
  it("reads the gateway's price, given as a decimal string", () => {
    const result = readUsage({
      requested: "openai/a",
      modelId: "openai/a-2026",
      usage,
      gateway: { cost: "0.0031", routing: { finalProvider: "azure" } },
    });
    expect(result).toEqual({
      model: "openai/a-2026",
      provider: "azure",
      inputTokens: 2400,
      outputTokens: 310,
      reasoningTokens: 60,
      cachedInputTokens: 400,
      costUsd: 0.0031,
    });
  });

  it("falls back to the market cost and the requested model", () => {
    const result = readUsage({
      requested: "openai/a",
      modelId: undefined,
      usage,
      gateway: { marketCost: 0.002 },
    });
    expect(result.model).toBe("openai/a");
    expect(result.costUsd).toBe(0.002);
    expect(result.provider).toBeNull();
  });

  it("leaves the cost null when the gateway reports none", () => {
    expect(
      readUsage({ requested: "m", modelId: "m", usage, gateway: undefined })
        .costUsd,
    ).toBeNull();
  });
});
