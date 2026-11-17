/**
 * Keeps the Analyst's conversation small. Old tool results (pages read,
 * grep hits, code output) are trimmed once the history passes a budget; the
 * newest ones and loaded Skills stay whole. Trimming rewrites old messages,
 * which costs a cache miss, so it runs only past the budget, not every turn.
 */
import type { ModelMessage } from "ai";

export const HISTORY_LIMITS = {
  /** Characters of tool output kept before trimming starts. */
  budgetChars: 160_000,
  /** Tool messages at the end that are never trimmed. */
  keepRecent: 6,
  /** What is left of a trimmed result. */
  trimmedChars: 600,
};

const KEEP_TOOLS = new Set(["load_skill"]);

type ToolPart = {
  type: "tool-result";
  toolName: string;
  output: { type: string; value?: unknown };
};

function toolParts(message: ModelMessage): ToolPart[] {
  if (message.role !== "tool" || !Array.isArray(message.content)) return [];
  return message.content.filter(
    (part): part is ToolPart & typeof part => part.type === "tool-result",
  ) as unknown as ToolPart[];
}

function textOf(part: ToolPart) {
  return part.output.type === "text" && typeof part.output.value === "string"
    ? part.output.value
    : "";
}

export function historyChars(messages: ModelMessage[]) {
  return messages
    .flatMap(toolParts)
    .reduce((sum, part) => sum + textOf(part).length, 0);
}

/** The history with old, long tool results trimmed when it is over budget. */
export function compactHistory(
  messages: ModelMessage[],
  limits = HISTORY_LIMITS,
): ModelMessage[] {
  let total = historyChars(messages);
  if (total <= limits.budgetChars) return messages;
  const toolIndexes = messages
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const protectedFrom =
    toolIndexes[Math.max(0, toolIndexes.length - limits.keepRecent)] ??
    messages.length;
  return messages.map((message, index) => {
    if (
      index >= protectedFrom ||
      message.role !== "tool" ||
      total <= limits.budgetChars
    )
      return message;
    const content = message.content.map((part) => {
      if (part.type !== "tool-result") return part;
      const tool = part as unknown as ToolPart;
      const text = textOf(tool);
      if (KEEP_TOOLS.has(tool.toolName) || text.length <= limits.trimmedChars)
        return part;
      total -= text.length - limits.trimmedChars;
      return {
        ...part,
        output: {
          type: "text" as const,
          value: `${text.slice(0, limits.trimmedChars)}\n… [trimmed from your context to save space; run the tool again if you need it]`,
        },
      };
    });
    return { ...message, content } as ModelMessage;
  });
}
