import { describe, expect, it } from "vitest";
import { addUsage, realtimeCost } from "./models";

const GPT = "openai/gpt-realtime-2.1";
const M = 1_000_000;

describe("realtimeCost", () => {
  it("prices each kind of token at its own rate", () => {
    // textIn 4, textOut 24, audioIn 32, audioOut 64 per million.
    expect(realtimeCost(GPT, { inputTextTokens: M })).toBeCloseTo(4, 10);
    expect(realtimeCost(GPT, { outputTextTokens: M })).toBeCloseTo(24, 10);
    expect(realtimeCost(GPT, { inputAudioTokens: M })).toBeCloseTo(32, 10);
    expect(realtimeCost(GPT, { outputAudioTokens: M })).toBeCloseTo(64, 10);
  });

  it("splits cached input off text and audio at the cached rate", () => {
    const cost = realtimeCost(GPT, {
      inputTextTokens: 1000,
      inputAudioTokens: 2000,
      outputTextTokens: 100,
      outputAudioTokens: 500,
      cachedInputTextTokens: 400,
      cachedInputAudioTokens: 1000,
    });
    const expected =
      (600 * 4 + 1000 * 32 + 1400 * 0.4 + 100 * 24 + 500 * 64) / M;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("never caches more than was sent", () => {
    const cost = realtimeCost(GPT, {
      inputTextTokens: 100,
      inputAudioTokens: 100,
      cachedInputTextTokens: 5000,
      cachedInputAudioTokens: 5000,
    });
    expect(cost).toBeCloseTo((200 * 0.4) / M, 12);
  });

  it("treats everything not audio as text when a provider reports totals only", () => {
    expect(realtimeCost(GPT, { inputTokens: M, outputTokens: M })).toBeCloseTo(
      28,
      10,
    );
    const cost = realtimeCost(GPT, {
      inputTokens: 3000,
      inputAudioTokens: 2000,
      cachedInputTokens: 1500,
      cachedInputAudioTokens: 1000,
      outputTokens: 700,
      outputAudioTokens: 500,
    });
    // text in 1000 (500 cached), audio in 2000 (1000 cached), text out 200, audio out 500.
    const expected =
      (500 * 4 + 1000 * 32 + 1500 * 0.4 + 200 * 24 + 500 * 64) / M;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("is zero for an unknown model or no usage", () => {
    expect(realtimeCost("someone/else", { inputTokens: M })).toBe(0);
    expect(realtimeCost(GPT, {})).toBe(0);
  });

  it("ignores negative and non-finite counts", () => {
    expect(
      realtimeCost(GPT, {
        inputAudioTokens: -5,
        outputAudioTokens: Number.NaN,
        inputTokens: Number.POSITIVE_INFINITY,
      }),
    ).toBe(0);
  });

  it("prices models differently", () => {
    const usage = { inputAudioTokens: M, outputAudioTokens: M };
    expect(realtimeCost("google/gemini-3.8-live", usage)).toBeCloseTo(15, 10);
    expect(realtimeCost("openai/gpt-realtime-mini", usage)).toBeCloseTo(30, 10);
  });
});

describe("addUsage", () => {
  it("sums each counter and keeps counters only one side has", () => {
    expect(
      addUsage(
        { inputTokens: 10, outputAudioTokens: 5 },
        { inputTokens: 3, cachedInputTokens: 2 },
      ),
    ).toEqual({ inputTokens: 13, outputAudioTokens: 5, cachedInputTokens: 2 });
  });

  it("skips zero, negative and non-finite values", () => {
    expect(
      addUsage(
        { inputTokens: 10 },
        {
          inputTokens: -4,
          outputTokens: 0,
          inputAudioTokens: Number.NaN,
          outputAudioTokens: Number.POSITIVE_INFINITY,
        },
      ),
    ).toEqual({ inputTokens: 10 });
  });

  it("does not change the running total it is given", () => {
    const total = { inputTokens: 1 };
    addUsage(total, { inputTokens: 1 });
    expect(total).toEqual({ inputTokens: 1 });
  });
});
