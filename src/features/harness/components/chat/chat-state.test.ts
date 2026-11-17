import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../domain/chat-events";
import type { MessageView } from "../../domain/session";
import {
  type Attachment,
  applyChatEvent,
  beginStream,
  emptyTurn,
  failStream,
  liveVisibility,
  readyAttachmentIds,
  reduceTurn,
  runningTool,
  sendBlocker,
  stopStream,
  streamIsSaved,
  summarizeArgs,
  turnAnnouncement,
  turnFromMessage,
} from "./chat-state";

const replay = (events: ChatEvent[]) => events.reduce(reduceTurn, emptyTurn());

describe("reduceTurn", () => {
  it("joins text deltas and reasoning deltas", () => {
    const turn = replay([
      { type: "reasoning.delta", text: "Let me " },
      { type: "reasoning.delta", text: "check." },
      { type: "text.delta", text: "Hello" },
      { type: "text.delta", text: " world" },
    ]);
    expect(turn.text).toBe("Hello world");
    expect(turn.reasoning).toBe("Let me check.");
  });

  it("follows a tool call from started to finished", () => {
    const started = replay([
      { type: "tool.started", id: "t1", name: "search", args: { q: "x" } },
    ]);
    expect(started.activity[0]).toMatchObject({ status: "running" });
    expect(runningTool(started)).toBe("search");
    const finished = reduceTurn(started, {
      type: "tool.finished",
      id: "t1",
      ok: false,
      summary: "no hits",
    });
    expect(finished.activity).toHaveLength(1);
    expect(finished.activity[0]).toMatchObject({
      status: "failed",
      summary: "no hits",
    });
    expect(runningTool(finished)).toBeNull();
  });

  it("keeps cards in order and shows each once", () => {
    const turn = replay([
      { type: "skill.loaded", skillId: "s1", name: "Member requests" },
      { type: "run.card", runId: "r1", pipelineId: "member_request" },
      { type: "run.card", runId: "r1", pipelineId: "member_request" },
      { type: "source.card", sourceId: "src", title: "Guide" },
      { type: "conflict.card", conflictId: "c1", summary: "Rates differ" },
    ]);
    expect(turn.activity.map((item) => item.type)).toEqual([
      "skill",
      "run",
      "source",
      "conflict",
    ]);
  });

  it("records usage, error and done", () => {
    const turn = replay([
      {
        type: "usage",
        model: "m",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
      },
      { type: "done", messageId: "msg" },
    ]);
    expect(turn.usage).toEqual({
      model: "m",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    });
    expect(turn.done).toBe(true);
    expect(turn.messageId).toBe("msg");
    expect(reduceTurn(turn, { type: "error", message: "boom" }).error).toBe(
      "boom",
    );
  });
});

describe("turnFromMessage", () => {
  it("rebuilds a saved Agent message in the live shape", () => {
    const message: MessageView = {
      id: "m1",
      sessionId: "s",
      role: "agent",
      staff: null,
      content: "Done.",
      parts: [
        { type: "reasoning", text: "thinking" },
        {
          type: "tool",
          id: "t",
          name: "lookup",
          args: {},
          ok: true,
          summary: "found",
        },
        { type: "run", runId: "r", pipelineId: "delinquency_report" },
      ],
      usage: { model: "m", inputTokens: 1, outputTokens: 2, costUsd: null },
      createdAt: "2026-01-01T00:00:00Z",
    };
    const turn = turnFromMessage(message);
    expect(turn.text).toBe("Done.");
    expect(turn.reasoning).toBe("thinking");
    expect(turn.activity.map((item) => item.type)).toEqual(["tool", "run"]);
    expect(turn.activity[0]).toMatchObject({ status: "ok" });
    expect(turn.done).toBe(true);
  });
});

describe("summarizeArgs", () => {
  it("shows the first two arguments and cuts long ones", () => {
    expect(summarizeArgs({ q: "leaving", limit: 5, extra: true })).toBe(
      "q: leaving, limit: 5",
    );
    expect(summarizeArgs({ q: "x".repeat(200) }, 20)).toHaveLength(20);
    expect(summarizeArgs({})).toBe("");
  });
});

describe("a Session's stream", () => {
  const start = () => beginStream("s1", { text: "hi" }, { baseline: 4 });

  it("streams, then ends done", () => {
    let stream = start();
    stream = applyChatEvent(stream, { type: "text.delta", text: "a" });
    expect(stream.status).toBe("streaming");
    stream = applyChatEvent(stream, { type: "done", messageId: "m" });
    expect(stream.status).toBe("done");
    expect(stream.turn.text).toBe("a");
  });

  it("fails on an error event and then ignores later events", () => {
    let stream = applyChatEvent(start(), { type: "error", message: "bad" });
    expect(stream).toMatchObject({ status: "failed", error: "bad" });
    stream = applyChatEvent(stream, { type: "text.delta", text: "late" });
    expect(stream.turn.text).toBe("");
  });

  it("failStream keeps the HTTP status; stopStream keeps the partial text", () => {
    const failed = failStream(start(), "limit", 429);
    expect(failed).toMatchObject({ status: "failed", errorStatus: 429 });
    const partial = applyChatEvent(start(), { type: "text.delta", text: "ab" });
    const stopped = stopStream(partial);
    expect(stopped.status).toBe("stopped");
    expect(stopped.turn.text).toBe("ab");
    expect(stopStream(stopped)).toBe(stopped);
  });

  it("stands in for whatever the history does not hold yet", () => {
    const stream = start();
    expect(liveVisibility(stream, 4)).toEqual({ staff: true, agent: true });
    expect(liveVisibility(stream, 5)).toEqual({ staff: false, agent: true });
    const done = applyChatEvent(stream, { type: "done", messageId: "m" });
    expect(liveVisibility(done, 6)).toEqual({ staff: false, agent: false });
  });

  it("is dropped only once the whole turn is saved; a failed one stays", () => {
    const done = applyChatEvent(start(), { type: "done", messageId: "m" });
    expect(streamIsSaved(done, 5)).toBe(false);
    expect(streamIsSaved(done, 6)).toBe(true);
    expect(streamIsSaved(start(), 99)).toBe(false);
    expect(streamIsSaved(failStream(start(), "x"), 99)).toBe(false);
  });

  it("announces status, never the text", () => {
    expect(turnAnnouncement(undefined)).toBe("");
    const running = applyChatEvent(start(), {
      type: "tool.started",
      id: "t",
      name: "search",
      args: {},
    });
    expect(turnAnnouncement(running)).toContain("search");
  });
});

describe("composer rules", () => {
  const ready: Attachment = {
    localId: "a",
    name: "f.pdf",
    bytes: 1,
    state: "ready",
    progress: 1,
    sourceId: "src-1",
    error: null,
  };
  const base = {
    text: "hello",
    maxChars: 10,
    attachments: [] as Attachment[],
    streaming: false,
    blockedReason: null,
  };

  it("lists only the ready files", () => {
    expect(
      readyAttachmentIds([
        ready,
        { ...ready, localId: "b", state: "failed", sourceId: null },
        { ...ready, localId: "c", state: "uploading", sourceId: null },
      ]),
    ).toEqual(["src-1"]);
  });

  it("says why Send is off, in order of importance", () => {
    expect(sendBlocker(base)).toBeNull();
    expect(sendBlocker({ ...base, streaming: true })).toMatch(/answering/);
    expect(sendBlocker({ ...base, blockedReason: "Limit." })).toBe("Limit.");
    expect(
      sendBlocker({
        ...base,
        attachments: [{ ...ready, state: "uploading" }],
      }),
    ).toMatch(/uploading/);
    expect(sendBlocker({ ...base, text: "x".repeat(11) })).toMatch(/at most/);
    expect(sendBlocker({ ...base, text: "  " })).toMatch(/Write a message/);
  });
});
