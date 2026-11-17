import { describe, expect, it } from "vitest";
import type { ChatEvent } from "./chat-events";
import {
  cardEventsOf,
  cutArgs,
  HISTORY,
  historyOf,
  instructionsFor,
  partsOf,
  stubReplyOf,
  stubToolCallOf,
  toolOk,
  toolSummaryOf,
  webSummaryOf,
} from "./chat-turn";

const output = (text: string, extra: Record<string, unknown> = {}) => ({
  content: [{ type: "text", text }],
  ...extra,
});

describe("tool results", () => {
  it("summarises a tool by the first line of its text, cut", () => {
    expect(toolSummaryOf(output("3 Members.\n[{...}]"))).toBe("3 Members.");
    expect(toolSummaryOf(output("x".repeat(500))).length).toBe(160);
    expect(toolSummaryOf(null)).toBe("");
    expect(toolOk(output("Sandbox offline.", { isError: true }))).toBe(false);
    expect(toolOk(output("ok"))).toBe(true);
  });

  it("turns cards into events, and ignores a failed tool's", () => {
    const result = output("Started", {
      structuredContent: {
        cards: {
          run: { runId: "r1", pipelineId: "member_request" },
          sources: [{ sourceId: "s1", title: "Circular" }],
          conflicts: [{ conflictId: "c1", summary: "Notice period differs" }],
        },
      },
    });
    expect(cardEventsOf(result)).toEqual([
      { type: "run.card", runId: "r1", pipelineId: "member_request" },
      { type: "source.card", sourceId: "s1", title: "Circular" },
      {
        type: "conflict.card",
        conflictId: "c1",
        summary: "Notice period differs",
      },
    ]);
    expect(cardEventsOf({ ...result, isError: true })).toEqual([]);
    expect(
      cardEventsOf(
        output("x", {
          structuredContent: {
            cards: { run: { runId: "r", pipelineId: "nope" } },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("caps the cards one call may add", () => {
    const conflicts = Array.from({ length: 20 }, (_, index) => ({
      conflictId: `c${index}`,
      summary: "s",
    }));
    expect(
      cardEventsOf(
        output("x", { structuredContent: { cards: { conflicts } } }),
      ),
    ).toHaveLength(6);
  });

  it("summarises web search", () => {
    expect(webSummaryOf({ results: [{}, {}] })).toEqual({
      ok: true,
      summary: "2 results",
    });
    expect(webSummaryOf({ error: "down" }).ok).toBe(false);
  });

  it("cuts long arguments and hides secrets", () => {
    const cut = cutArgs({ text: "y".repeat(1_000), apiKey: "sk-123" });
    expect(String(cut.text).length).toBeLessThan(400);
    expect(cut.apiKey).toBe("[redacted]");
    expect(cutArgs("not an object")).toEqual({});
  });
});

describe("message parts", () => {
  it("keeps tools once, with how they finished, and the cards in order", () => {
    const events: ChatEvent[] = [
      { type: "reasoning.delta", text: "Think" },
      { type: "reasoning.delta", text: "ing" },
      {
        type: "tool.started",
        id: "t1",
        name: "pipeline_member_request",
        args: { a: 1 },
      },
      { type: "text.delta", text: "Hi" },
      { type: "tool.finished", id: "t1", ok: true, summary: "Started" },
      { type: "run.card", runId: "r1", pipelineId: "member_request" },
      { type: "skill.loaded", skillId: "k", name: "member-request" },
      {
        type: "usage",
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      },
    ];
    expect(partsOf(events)).toEqual([
      { type: "reasoning", text: "Thinking" },
      {
        type: "tool",
        id: "t1",
        name: "pipeline_member_request",
        args: { a: 1 },
        ok: true,
        summary: "Started",
      },
      { type: "run", runId: "r1", pipelineId: "member_request" },
      { type: "skill", skillId: "k", name: "member-request" },
    ]);
  });
});

describe("history", () => {
  it("keeps the latest messages, starting on a Staff message", () => {
    const messages = [
      { role: "agent" as const, content: "old answer" },
      { role: "staff" as const, content: "q1" },
      { role: "agent" as const, content: "a1" },
      { role: "staff" as const, content: "" },
    ];
    expect(historyOf(messages)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("caps the window by count and by characters", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      role: index % 2 === 0 ? ("staff" as const) : ("agent" as const),
      content: `m${index}`,
    }));
    expect(historyOf(many).length).toBeLessThanOrEqual(HISTORY.messages);
    const long = [
      { role: "staff" as const, content: "x".repeat(HISTORY.chars) },
      { role: "agent" as const, content: "a" },
      { role: "staff" as const, content: "q" },
      { role: "agent" as const, content: "b" },
    ];
    expect(historyOf(long)).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "b" },
    ]);
  });
});

describe("instructions", () => {
  const base = {
    staff: {
      name: "Keisha Wraymond",
      title: "Pensions Officer",
      role: "user" as const,
    },
    today: "2026-11-17",
    skills: [
      {
        id: "member-request",
        name: "member-request",
        description: "Use when a Member asks to withdraw or transfer.",
        kind: "skill" as const,
      },
      {
        id: "member-request-rules",
        name: "member-request-rules",
        description: "The Rules.",
        kind: "rulebook" as const,
      },
    ],
    attachments: [],
    sandbox: false,
  };

  it("names the Staff member, the Role, the date and the Skill index", () => {
    const text = instructionsFor(base);
    expect(text).toContain("Keisha Wraymond, Pensions Officer (Role: user)");
    expect(text).toContain("Today is 2026-11-17");
    expect(text).toContain("- member-request: Use when a Member asks");
    expect(text).toContain("member-request-rules [Rulebook]");
    expect(text).toContain("load_skill");
  });

  it("holds the Agent to the glossary: never approves, never decides, cites, no advice, says when a Conflict is open", () => {
    const text = instructionsFor(base);
    expect(text).toMatch(/never approve anything/);
    expect(text).toMatch(/never decide a case yourself/);
    expect(text).toMatch(/start the Pipeline/);
    expect(text).toMatch(/cite each Passage/);
    expect(text).toMatch(/no financial, tax, investment or legal advice/);
    expect(text).toMatch(/a Conflict is open/);
  });

  it("says what was attached, and whether the Sandbox may be used", () => {
    const text = instructionsFor({
      ...base,
      sandbox: true,
      attachments: [
        {
          sourceId: "s1",
          title: "Schedule March",
          kind: "csv",
          status: "pending",
        },
      ],
    });
    expect(text).toContain('"Schedule March" (csv, pending, id s1)');
    expect(text).toContain("file_source");
    expect(text).toMatch(/may write and run code/);
    expect(instructionsFor(base)).toMatch(/may not use the Sandbox/);
  });

  it("works with no Skills", () => {
    expect(instructionsFor({ ...base, skills: [] })).toContain(
      "(No Skills are available right now.)",
    );
  });
});

describe("the e2e stub", () => {
  it("answers without a model", () => {
    expect(stubReplyOf("hello  there", 2)).toBe(
      'Stub reply: I read "hello there" with 2 attachments. No model was called.',
    );
  });
});

describe("stubToolCallOf (the e2e chat turn)", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  it("runs the delinquency report for last month", () => {
    expect(
      stubToolCallOf("Prepare the delinquency report", [], "2026-01-10"),
    ).toEqual({
      name: "pipeline_delinquency_report",
      args: { period: "2025-12" },
    });
  });
  it("runs Contribution processing on an attached Schedule", () => {
    expect(
      stubToolCallOf(
        "Process this",
        [{ sourceId: id, kind: "csv" }],
        "2026-01-10",
      ),
    ).toEqual({
      name: "pipeline_contribution_processing",
      args: { sourceId: id },
    });
  });
  it("runs a Member request on other attachments, as a list", () => {
    expect(
      stubToolCallOf(
        "Handle it",
        [{ sourceId: id, kind: "text" }],
        "2026-01-10",
      ),
    ).toEqual({ name: "pipeline_member_request", args: { sourceIds: [id] } });
  });
  it("searches the Knowledge base otherwise", () => {
    expect(
      stubToolCallOf("What is the property cap?", [], "2026-01-10")?.name,
    ).toBe("search_knowledge");
    expect(stubToolCallOf("", [], "2026-01-10")).toBeNull();
  });
});
