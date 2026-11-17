import type { PipelineId } from "./pipeline";
import type { SessionSummary } from "./session";

/**
 * What the chat route streams back for one message, one JSON object per line
 * (NDJSON). The stream always ends with `done` or `error`.
 */
export type ChatEvent =
  /** The Session as it now stands: sent first, when the first message names it. */
  | { type: "session"; session: SessionSummary }
  | { type: "text.delta"; text: string }
  /** The model thinking before it answers or calls a tool. Not every model sends it. */
  | { type: "reasoning.delta"; text: string }
  | {
      type: "tool.started";
      /** The tool call's id; `tool.finished` carries the same one. */
      id: string;
      name: string;
      /** The arguments, long values cut (as the Audit trail keeps them). */
      args: Record<string, unknown>;
    }
  | { type: "tool.finished"; id: string; ok: boolean; summary: string }
  | { type: "skill.loaded"; skillId: string; name: string }
  /** A Run was started: the chat shows a card with "View pipeline". */
  | { type: "run.card"; runId: string; pipelineId: PipelineId }
  | { type: "source.card"; sourceId: string; title: string }
  | { type: "conflict.card"; conflictId: string; summary: string }
  | {
      type: "usage";
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
    }
  | { type: "error"; message: string }
  | { type: "done"; messageId: string };

export type ChatEventType = ChatEvent["type"];

/** The tools that run in the chat, not on the Harness MCP server (ADR 0013). */
export const CHAT_LOCAL_TOOLS = ["load_skill", "web_search"] as const;
