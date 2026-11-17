import { describe, expect, it } from "vitest";
import type { ExtractedName, RunEvent } from "../domain/contract";
import {
  emptyRunView,
  foldEvents,
  liveNodes,
  mergeNames,
  nodeCounts,
  reduceRunView,
  type SeqEvent,
  withSeq,
} from "./run-view";

const seq = (events: RunEvent[]) => events.map(withSeq);

const start: RunEvent = {
  at: 1000,
  type: "start",
  document: { id: "doc-1", title: "Wire ledger", pages: 40 },
  source: { kind: "corpus", corpusId: "doc-1" },
  models: {
    analyst: "openai/gpt-6.1-terra",
    reader: "anthropic/claude-haiku-5.5",
  },
  rulebookVersion: 3,
};

const name = (canonical: string, confidence = 0.9): ExtractedName => ({
  canonical,
  type: "person",
  aliases: [],
  roles: ["counterparty"],
  mentions: [{ page: 2, quote: canonical }],
  confidence,
  foundBy: ["reader"],
});

describe("reduceRunView", () => {
  it("reads the start and marks the Run running", () => {
    const view = foldEvents(seq([start]));
    expect(view.status).toBe("running");
    expect(view.document?.pages).toBe(40);
    expect(view.rulebookVersion).toBe(3);
    expect(view.startedAt).toBe(1000);
  });

  it("folds a tool call's start and done into one timeline item, counted once", () => {
    const view = foldEvents(
      seq([
        start,
        {
          at: 1100,
          type: "tool",
          callId: "c1",
          tool: "grep",
          summary: "/Ltd/",
          input: { pattern: "Ltd" },
          state: "start",
        },
        {
          at: 1200,
          type: "tool",
          callId: "c1",
          tool: "grep",
          summary: "/Ltd/",
          input: { pattern: "Ltd" },
          state: "done",
          output: "12 hits",
          ms: 100,
        },
      ]),
    );
    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0]).toMatchObject({
      kind: "tool",
      state: "done",
      output: "12 hits",
      ms: 100,
    });
    expect(view.toolCounts.grep).toBe(1);
  });

  it("attaches a code cell to its run_code call", () => {
    const view = foldEvents(
      seq([
        {
          at: 1,
          type: "tool",
          callId: "k",
          tool: "run_code",
          summary: "count suffixes",
          input: {},
          state: "start",
        },
        {
          at: 2,
          type: "code",
          callId: "k",
          code: "console.log(1)",
          stdout: "1",
          stderr: "",
          exitCode: 0,
          ms: 40,
        },
      ]),
    );
    expect(view.timeline).toHaveLength(1);
    const item = view.timeline[0];
    expect(item.kind === "tool" && item.code?.stdout).toBe("1");
    expect(view.toolCounts.run_code).toBe(1);
  });

  it("tracks Readers by id and sums cost per purpose and model", () => {
    const view = foldEvents(
      seq([
        start,
        {
          at: 2,
          type: "reader",
          readerId: "r1",
          from: 1,
          to: 20,
          state: "start",
        },
        {
          at: 3,
          type: "reader",
          readerId: "r2",
          from: 21,
          to: 40,
          state: "start",
        },
        {
          at: 4,
          type: "reader",
          readerId: "r1",
          from: 1,
          to: 20,
          state: "done",
          names: 7,
          ms: 900,
        },
        {
          at: 5,
          type: "cost",
          purpose: "reader",
          model: "anthropic/claude-haiku-5.5",
          costUsd: 0.002,
          inputTokens: 1000,
          outputTokens: 200,
          cachedInputTokens: 500,
          ms: 900,
        },
        {
          at: 6,
          type: "cost",
          purpose: "analyst",
          model: "openai/gpt-6.1-terra",
          costUsd: 0.01,
          inputTokens: 3000,
          outputTokens: 400,
          cachedInputTokens: 0,
          ms: 1200,
        },
      ]),
    );
    expect(view.readers.map((reader) => reader.state)).toEqual([
      "done",
      "start",
    ]);
    expect(view.readers[0].names).toBe(7);
    expect(view.cost.total.costUsd).toBeCloseTo(0.012);
    expect(view.cost.total.cachedInputTokens).toBe(500);
    expect(view.cost.byPurpose.reader?.calls).toBe(1);
    expect(view.cost.byModel["openai/gpt-6.1-terra"].inputTokens).toBe(3000);
    expect(liveNodes(view).has("readers")).toBe(true);
  });

  it("drops events it has already seen", () => {
    const once = foldEvents(
      seq([start, { at: 2, type: "thought", text: "hm" }]),
    );
    const again = reduceRunView(once, { ...start, seq: 0 } as SeqEvent);
    expect(again).toBe(once);
  });

  it("settles everything in flight when the Run ends, and keeps the score", () => {
    const view = foldEvents(
      seq([
        start,
        {
          at: 2,
          type: "reader",
          readerId: "r1",
          from: 1,
          to: 40,
          state: "start",
        },
        {
          at: 3,
          type: "tool",
          callId: "f",
          tool: "finish",
          summary: "",
          input: {},
          state: "start",
        },
        {
          at: 4,
          type: "end",
          status: "stopped",
        },
        { at: 5, type: "end", status: "completed" },
      ]),
    );
    expect(view.status).toBe("stopped");
    expect(view.endedAt).toBe(4);
    expect(view.readers[0].state).toBe("error");
    expect(view.timeline[0]).toMatchObject({ state: "error" });
    expect(liveNodes(view).size).toBe(0);
  });

  it("records the score of a completed corpus Run", () => {
    const score = {
      expected: 10,
      found: 11,
      truePositives: 9,
      recall: 0.9,
      precision: 9 / 11,
      missed: ["Ana Vos"],
    };
    const view = foldEvents(
      seq([start, { at: 9, type: "end", status: "completed", score }]),
    );
    expect(view.score).toEqual(score);
  });

  it("collects each Skill once and counts nodes", () => {
    const view = foldEvents(
      seq([
        { at: 1, type: "skill", skill: "alias-resolution" },
        { at: 2, type: "skill", skill: "alias-resolution" },
      ]),
    );
    expect(view.skills).toEqual(["alias-resolution"]);
    expect(view.timeline).toHaveLength(2);
    expect(nodeCounts(view).skills).toBe(1);
  });
});

describe("mergeNames", () => {
  it("replaces a Name by canonical form, case-insensitively, and keeps the rest", () => {
    const merged = mergeNames(
      [name("Ana Vos", 0.4), name("Orbis Ltd")],
      [name("ana vos", 0.95)],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((n) => n.canonical === "ana vos")?.confidence).toBe(
      0.95,
    );
  });

  it("is empty on an empty view", () => {
    expect(emptyRunView.names).toEqual([]);
  });
});
