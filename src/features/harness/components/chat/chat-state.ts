import type { ChatRequest } from "../../domain/api";
import type { AuditUsage } from "../../domain/audit";
import type { ChatEvent } from "../../domain/chat-events";
import type { PipelineId } from "../../domain/pipeline";
import type { MessageView } from "../../domain/session";

/**
 * Pure state for the chat: how ChatEvents build the Agent's turn, and how a
 * Session's live stream moves from streaming to done. No React, no fetch, so
 * all of it is unit-tested.
 */

export type ToolStatus = "running" | "ok" | "failed";

/** What the Agent did while answering, in the order it happened. */
export type ActivityItem =
  | {
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      summary: string;
    }
  | { type: "skill"; skillId: string; name: string }
  | { type: "run"; runId: string; pipelineId: PipelineId }
  | { type: "source"; sourceId: string; title: string }
  | { type: "conflict"; conflictId: string; summary: string };

/** One Agent message, live or saved: what it did, then what it said. */
export type AgentTurn = {
  activity: ActivityItem[];
  reasoning: string;
  /** Markdown. */
  text: string;
  usage: AuditUsage | null;
  messageId: string | null;
  error: string | null;
  done: boolean;
};

export const emptyTurn = (): AgentTurn => ({
  activity: [],
  reasoning: "",
  text: "",
  usage: null,
  messageId: null,
  error: null,
  done: false,
});

const addOnce = (
  activity: ActivityItem[],
  item: ActivityItem,
  same: (existing: ActivityItem) => boolean,
): ActivityItem[] => (activity.some(same) ? activity : [...activity, item]);

/** Applies one ChatEvent to the Agent's turn. Pure; events that are not about the turn change nothing. */
export function reduceTurn(turn: AgentTurn, event: ChatEvent): AgentTurn {
  switch (event.type) {
    case "text.delta":
      return { ...turn, text: turn.text + event.text };
    case "reasoning.delta":
      return { ...turn, reasoning: turn.reasoning + event.text };
    case "tool.started": {
      const item: ActivityItem = {
        type: "tool",
        id: event.id,
        name: event.name,
        args: event.args,
        status: "running",
        summary: "",
      };
      const known = turn.activity.some(
        (entry) => entry.type === "tool" && entry.id === event.id,
      );
      return {
        ...turn,
        activity: known
          ? turn.activity.map((entry) =>
              entry.type === "tool" && entry.id === event.id ? item : entry,
            )
          : [...turn.activity, item],
      };
    }
    case "tool.finished":
      return {
        ...turn,
        activity: turn.activity.map((entry) =>
          entry.type === "tool" && entry.id === event.id
            ? {
                ...entry,
                status: event.ok ? ("ok" as const) : ("failed" as const),
                summary: event.summary,
              }
            : entry,
        ),
      };
    case "skill.loaded":
      return {
        ...turn,
        activity: addOnce(
          turn.activity,
          { type: "skill", skillId: event.skillId, name: event.name },
          (entry) => entry.type === "skill" && entry.skillId === event.skillId,
        ),
      };
    case "run.card":
      return {
        ...turn,
        activity: addOnce(
          turn.activity,
          { type: "run", runId: event.runId, pipelineId: event.pipelineId },
          (entry) => entry.type === "run" && entry.runId === event.runId,
        ),
      };
    case "source.card":
      return {
        ...turn,
        activity: addOnce(
          turn.activity,
          { type: "source", sourceId: event.sourceId, title: event.title },
          (entry) =>
            entry.type === "source" && entry.sourceId === event.sourceId,
        ),
      };
    case "conflict.card":
      return {
        ...turn,
        activity: addOnce(
          turn.activity,
          {
            type: "conflict",
            conflictId: event.conflictId,
            summary: event.summary,
          },
          (entry) =>
            entry.type === "conflict" && entry.conflictId === event.conflictId,
        ),
      };
    case "usage":
      return {
        ...turn,
        usage: {
          model: event.model,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
        },
      };
    case "error":
      return { ...turn, error: event.message };
    case "done":
      return { ...turn, done: true, messageId: event.messageId };
    case "session":
      return turn;
  }
}

/** A saved Agent message as the same shape the live stream builds. */
export function turnFromMessage(message: MessageView): AgentTurn {
  const turn = emptyTurn();
  const reasoning: string[] = [];
  for (const part of message.parts) {
    switch (part.type) {
      case "reasoning":
        reasoning.push(part.text);
        break;
      case "tool":
        turn.activity.push({
          type: "tool",
          id: part.id,
          name: part.name,
          args: part.args,
          status: part.ok ? "ok" : "failed",
          summary: part.summary,
        });
        break;
      case "skill":
        turn.activity.push(part);
        break;
      case "run":
        turn.activity.push(part);
        break;
      case "source":
        turn.activity.push(part);
        break;
      case "conflict":
        turn.activity.push(part);
        break;
      case "attachment":
        break;
    }
  }
  return {
    ...turn,
    reasoning: reasoning.join("\n\n"),
    text: message.content,
    usage: message.usage,
    messageId: message.id,
    done: true,
  };
}

/** The name of the tool at work right now, if any. */
export function runningTool(turn: AgentTurn): string | null {
  for (let index = turn.activity.length - 1; index >= 0; index -= 1) {
    const item = turn.activity[index];
    if (item?.type === "tool" && item.status === "running") return item.name;
  }
  return null;
}

/** What a screen reader hears while the turn streams: a status, never the text itself. */
export function turnAnnouncement(stream: SessionStream | undefined): string {
  if (!stream) return "";
  if (stream.status === "streaming") {
    const tool = runningTool(stream.turn);
    return tool ? `The Agent is using ${tool}.` : "The Agent is answering.";
  }
  if (stream.status === "done") return "The Agent has finished answering.";
  if (stream.status === "stopped") return "Stopped.";
  return `The answer failed. ${stream.error ?? ""}`.trim();
}

// Tool lines ------------------------------------------------------------------

function shortValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** One short line on a tool call's arguments: `q: leaving Cayman, limit: 5`. */
export function summarizeArgs(
  args: Record<string, unknown>,
  max = 80,
  keys = 2,
): string {
  const parts = Object.entries(args)
    .filter(([, value]) => shortValue(value) !== "")
    .slice(0, keys)
    .map(
      ([name, value]) => `${name}: ${shortValue(value).replace(/\s+/g, " ")}`,
    );
  const text = parts.join(", ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// A Session's live stream ---------------------------------------------------------

export type StreamStatus = "streaming" | "done" | "failed" | "stopped";

/** One turn in flight (or just ended) in one Session. Lives above the Session view. */
export type SessionStream = {
  sessionId: string;
  status: StreamStatus;
  request: ChatRequest;
  /** The names of what was attached, to show beside the Staff message before it is saved. */
  attachmentNames: string[];
  /** How many saved messages the Session had when this turn began. */
  baseline: number;
  startedAt: number;
  turn: AgentTurn;
  error: string | null;
  /** The HTTP status of a refusal before streaming (429 a limit), if that is what failed it. */
  errorStatus: number | null;
};

export function beginStream(
  sessionId: string,
  request: ChatRequest,
  options: { baseline?: number; attachmentNames?: string[]; now?: number } = {},
): SessionStream {
  return {
    sessionId,
    status: "streaming",
    request,
    attachmentNames: options.attachmentNames ?? [],
    baseline: options.baseline ?? 0,
    startedAt: options.now ?? Date.now(),
    turn: emptyTurn(),
    error: null,
    errorStatus: null,
  };
}

/** Applies a ChatEvent to a stream. Once a stream has ended nothing changes it. */
export function applyChatEvent(
  stream: SessionStream,
  event: ChatEvent,
): SessionStream {
  if (stream.status !== "streaming") return stream;
  const turn = reduceTurn(stream.turn, event);
  if (event.type === "error") {
    return { ...stream, turn, status: "failed", error: event.message };
  }
  if (event.type === "done") return { ...stream, turn, status: "done" };
  return { ...stream, turn };
}

export function failStream(
  stream: SessionStream,
  message: string,
  errorStatus: number | null = null,
): SessionStream {
  if (stream.status !== "streaming") return stream;
  return {
    ...stream,
    status: "failed",
    error: message,
    errorStatus,
    turn: { ...stream.turn, error: message },
  };
}

export function stopStream(stream: SessionStream): SessionStream {
  if (stream.status !== "streaming") return stream;
  return { ...stream, status: "stopped" };
}

/**
 * What of a live stream to draw, given how many saved messages the Session
 * has now. The server saves the Staff message first and the Agent's last, so
 * the stream stands in for whichever of the two is not in the history yet.
 */
export function liveVisibility(stream: SessionStream, historyCount: number) {
  return {
    staff: historyCount <= stream.baseline,
    agent: stream.status === "streaming" || historyCount <= stream.baseline + 1,
  };
}

/** True once the saved history holds the whole turn, so the live copy can go. A failed turn stays for its Retry. */
export function streamIsSaved(
  stream: SessionStream,
  historyCount: number,
): boolean {
  if (stream.status === "streaming" || stream.status === "failed") return false;
  return historyCount >= stream.baseline + 2;
}

// Composer ------------------------------------------------------------------------

export type Attachment = {
  localId: string;
  name: string;
  bytes: number;
  state: "uploading" | "ready" | "failed";
  /** 0..1 while the bytes go up; 1 while the Source is read. */
  progress: number;
  sourceId: string | null;
  error: string | null;
};

export function readyAttachmentIds(attachments: Attachment[]): string[] {
  return attachments.flatMap((attachment) =>
    attachment.state === "ready" && attachment.sourceId
      ? [attachment.sourceId]
      : [],
  );
}

/** Why Send is off, or null when it may be pressed. */
export function sendBlocker(input: {
  text: string;
  maxChars: number;
  attachments: Attachment[];
  streaming: boolean;
  blockedReason: string | null;
}): string | null {
  if (input.streaming) return "The Agent is answering. Stop it first, or wait.";
  if (input.blockedReason) return input.blockedReason;
  if (input.attachments.some((item) => item.state === "uploading"))
    return "Wait for the files to finish uploading.";
  if (input.text.length > input.maxChars)
    return `A message may be ${input.maxChars.toLocaleString("en")} characters at most.`;
  if (!input.text.trim()) return "Write a message first.";
  return null;
}
