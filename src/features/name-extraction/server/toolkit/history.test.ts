import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { compactHistory, historyChars } from "./history";

const toolMessage = (name: string, text: string): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: `${name}-${text.length}`,
      toolName: name,
      output: { type: "text", value: text },
    },
  ],
});

describe("compactHistory", () => {
  const limits = { budgetChars: 1000, keepRecent: 2, trimmedChars: 50 };

  it("leaves a history under budget untouched", () => {
    const messages = [toolMessage("grep", "x".repeat(100))];
    expect(compactHistory(messages, limits)).toBe(messages);
  });

  it("trims old long results, keeps the newest and loaded Skills whole", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "start" },
      toolMessage("load_skill", "s".repeat(600)),
      toolMessage("read_pages", "p".repeat(600)),
      toolMessage("grep", "g".repeat(600)),
      toolMessage("run_code", "c".repeat(600)),
    ];
    const compacted = compactHistory(messages, limits);
    const text = (message: ModelMessage) =>
      JSON.stringify(message.content).length;
    expect(text(compacted[1])).toBe(text(messages[1]));
    expect(JSON.stringify(compacted[2].content)).toContain(
      "trimmed from your context",
    );
    expect(text(compacted[3])).toBe(text(messages[3]));
    expect(text(compacted[4])).toBe(text(messages[4]));
    expect(historyChars(compacted)).toBeLessThan(historyChars(messages));
  });
});
