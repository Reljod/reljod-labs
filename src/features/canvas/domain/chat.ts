import type { ViewPayload } from "./payload";

/**
 * What a Question's stream carries (NDJSON, one event per line), and what an
 * Analyst message keeps of it. The page draws a live turn and a saved one
 * from the same events; a Replay is a recorded list of them.
 */
export type ChatEvent =
  | {
      type: "question";
      conversationId: string;
      questionId: string;
      title: string;
    }
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  /** The Analyst began writing a tool call; `title` is a View's title as it streams. */
  | { type: "tool.building"; id: string; name: string; title?: string }
  | {
      type: "tool.started";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool.finished";
      id: string;
      ok: boolean;
      summary: string;
      ms: number;
    }
  /** A View was made or revised: the same payload the App receives. */
  | { type: "view"; toolCallId: string; payload: ViewPayload }
  | { type: "skill.loaded"; name: string }
  | {
      type: "usage";
      model: string;
      turns: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      sandboxMs: number;
    }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; messageId: string | null };

/** An Analyst message's parts: its events with text merged and Views by id. */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      ok: boolean;
      summary: string;
      ms: number;
    }
  | { type: "view"; viewId: string }
  | { type: "skill"; name: string }
  | { type: "notice"; text: string };

export type MessageUsage = Extract<ChatEvent, { type: "usage" }>;

export type Message = {
  id: string;
  role: "person" | "analyst";
  content: string;
  parts: MessagePart[];
  usage: Omit<MessageUsage, "type"> | null;
  createdAt: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  views: number;
  updatedAt: string;
};

const REASONING_KEPT = 4000;

/** Folds a turn's events into the parts an Analyst message keeps. */
export function partsOf(events: readonly ChatEvent[]): MessagePart[] {
  const parts: MessagePart[] = [];
  const tools = new Map<string, Extract<MessagePart, { type: "tool" }>>();
  for (const event of events) {
    const last = parts[parts.length - 1];
    switch (event.type) {
      case "text.delta":
        if (last?.type === "text") last.text += event.text;
        else parts.push({ type: "text", text: event.text });
        break;
      case "reasoning.delta":
        if (last?.type === "reasoning") {
          if (last.text.length < REASONING_KEPT) last.text += event.text;
        } else parts.push({ type: "reasoning", text: event.text });
        break;
      case "tool.started": {
        const part = {
          type: "tool" as const,
          id: event.id,
          name: event.name,
          args: event.args,
          ok: false,
          summary: "Did not finish",
          ms: 0,
        };
        tools.set(event.id, part);
        parts.push(part);
        break;
      }
      case "tool.finished": {
        const part = tools.get(event.id);
        if (part) {
          part.ok = event.ok;
          part.summary = event.summary;
          part.ms = event.ms;
        }
        break;
      }
      case "view":
        parts.push({ type: "view", viewId: event.payload.view.id });
        break;
      case "skill.loaded":
        parts.push({ type: "skill", name: event.name });
        break;
      case "notice":
        parts.push({ type: "notice", text: event.text });
        break;
      default:
        break;
    }
  }
  return parts;
}

/** A Conversation's title from its first Question. */
export function titleOf(question: string) {
  const text = question.replace(/\s+/g, " ").trim();
  return text.length <= 70 ? text || "Question" : `${text.slice(0, 67).trimEnd()}…`;
}

const ARG_TEXT = 1200;

/** Tool arguments small enough to stream and store: long strings cut, deep things summarised. */
export function cutArgs(input: unknown): Record<string, unknown> {
  const cut = (value: unknown, depth: number): unknown => {
    if (typeof value === "string")
      return value.length > ARG_TEXT
        ? `${value.slice(0, ARG_TEXT)}… [${value.length - ARG_TEXT} more]`
        : value;
    if (Array.isArray(value))
      return depth > 4 ? "[…]" : value.slice(0, 30).map((item) => cut(item, depth + 1));
    if (value && typeof value === "object") {
      if (depth > 4) return "{…}";
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cut(item, depth + 1)]),
      );
    }
    return value;
  };
  const out = cut(input ?? {}, 0);
  return out && typeof out === "object" && !Array.isArray(out)
    ? (out as Record<string, unknown>)
    : { value: out };
}
