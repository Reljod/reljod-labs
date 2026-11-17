import type { AuditUsage } from "./audit";
import type { SourceKind } from "./knowledge";
import type { PipelineId } from "./pipeline";

export const NEW_SESSION_TITLE = "New session";
export const SESSION_TITLE_CHARS = 120;

export type SessionStatus = "open" | "closed";

/** One conversation between a Staff member and the Agent. */
export type SessionSummary = {
  id: string;
  title: string;
  status: SessionStatus;
  /** The Staff member the Session belongs to. */
  staff: { id: string; name: string; initials: string };
  /** The start of the latest message, for the list. */
  preview: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * What a message carries besides its text, in the order it happened. The chat
 * route saves these in `messages.parts`; the ChatEvents that build them are
 * in `chat-events.ts`.
 */
export type MessagePart =
  | {
      type: "attachment";
      sourceId: string;
      name: string;
      kind: SourceKind;
      bytes: number;
    }
  | { type: "reasoning"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      /** The arguments, long values cut. */
      args: Record<string, unknown>;
      ok: boolean;
      summary: string;
    }
  | { type: "skill"; skillId: string; name: string }
  | { type: "run"; runId: string; pipelineId: PipelineId }
  | { type: "source"; sourceId: string; title: string }
  | { type: "conflict"; conflictId: string; summary: string };

export type MessageRole = "staff" | "agent";

export type MessageView = {
  id: string;
  sessionId: string;
  role: MessageRole;
  /** Who wrote a `staff` message; null for the Agent. */
  staff: { id: string; name: string; initials: string } | null;
  /** Markdown. */
  content: string;
  parts: MessagePart[];
  /** What an Agent message cost. */
  usage: AuditUsage | null;
  createdAt: string;
};

/** A Session's title from its first message: the first line, cut at a word. */
export function titleFrom(text: string, max = 60): string {
  const line = text.trim().split(/\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return NEW_SESSION_TITLE;
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
