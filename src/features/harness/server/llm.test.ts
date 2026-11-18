import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { visibleThinking } from "./llm";

describe("visibleThinking", () => {
  it("asks Claude for summarized thinking, which it otherwise omits", () => {
    expect(visibleThinking("anthropic/claude-sonnet-5.5")).toEqual({
      anthropic: { thinking: { type: "adaptive", display: "summarized" } },
    });
  });

  it("asks OpenAI and Google models for their reasoning summaries", () => {
    expect(visibleThinking("openai/gpt-6.1-terra")).toEqual({
      openai: { reasoningSummary: "auto" },
    });
    expect(visibleThinking("google/gemini-3.5-flash")).toEqual({
      google: { thinkingConfig: { includeThoughts: true } },
    });
  });

  it("sends nothing to a provider it does not know", () => {
    expect(visibleThinking("zai/glm-5.3-flash")).toBeUndefined();
  });
});
