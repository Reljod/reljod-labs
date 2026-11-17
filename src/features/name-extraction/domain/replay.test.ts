import { describe, expect, it } from "vitest";
import type { ExtractedName, RunEvent } from "./contract";
import { cut, REPLAY_TEXT_CAP, slimEvents } from "./replay";

type Seq = RunEvent & { seq: number };

const name = (canonical: string): ExtractedName => ({
  canonical,
  type: "person",
  aliases: [],
  roles: [],
  mentions: [{ page: 1, quote: canonical }],
  confidence: 1,
  foundBy: ["reader"],
});

const long = "x".repeat(5000);

function trail(): Seq[] {
  const events: RunEvent[] = [
    { at: 1, type: "thought", text: long },
    {
      at: 2,
      type: "tool",
      callId: "a",
      tool: "record_names",
      summary: "2 names",
      input: { names: Array.from({ length: 50 }, (_, i) => name(`N${i}`)) },
      state: "done",
      output: long,
    },
    { at: 3, type: "names", names: [name("Ana")] },
    { at: 4, type: "names", names: [name("Ana"), name("Erik")] },
    {
      at: 5,
      type: "gate",
      gate: { pagesTotal: 2, pagesRead: 2, candidatesOpen: 0, passed: true },
    },
    {
      at: 6,
      type: "tool",
      callId: "b",
      tool: "spawn_readers",
      summary: "1-2",
      input: { ranges: [[1, 2]] },
      state: "done",
      output: "ok",
    },
    {
      at: 7,
      type: "code",
      callId: "c",
      code: long,
      stdout: long,
      stderr: "",
      exitCode: 0,
      ms: 4,
    },
    { at: 8, type: "names", names: [name("Ana"), name("Erik"), name("Grace")] },
    { at: 9, type: "end", status: "completed" },
  ];
  return events.map((event, i) => ({ ...event, seq: i + 1 }));
}

describe("slimEvents", () => {
  it("cuts long texts and big tool inputs", () => {
    const slim = slimEvents(trail());
    const tool = slim.find((e) => e.type === "tool" && e.callId === "a");
    expect(tool?.type === "tool" && tool.output?.length).toBe(REPLAY_TEXT_CAP);
    expect(tool?.type === "tool" && typeof tool.input).toBe("string");
    const code = slim.find((e) => e.type === "code");
    expect(code?.type === "code" && code.code.length).toBe(REPLAY_TEXT_CAP);
    expect(code?.type === "code" && code.stdout.length).toBe(REPLAY_TEXT_CAP);
    const small = slim.find((e) => e.type === "tool" && e.callId === "b");
    expect(small?.type === "tool" && small.input).toEqual({ ranges: [[1, 2]] });
  });

  it("keeps the last names event and the Reader merges, keeping seq", () => {
    const slim = slimEvents(trail());
    expect(slim.filter((e) => e.type === "names").map((e) => e.seq)).toEqual([
      4, 8,
    ]);
    expect(slim.map((e) => e.seq)).toEqual([1, 2, 4, 5, 6, 7, 8, 9]);
  });

  it("drops the Reader merges when they do not fit", () => {
    const slim = slimEvents(trail(), 100);
    expect(slim.filter((e) => e.type === "names").map((e) => e.seq)).toEqual([
      8,
    ]);
  });
});

describe("cut", () => {
  it("leaves short text alone and marks a cut", () => {
    expect(cut("abc", 5)).toBe("abc");
    expect(cut("abcdef", 4)).toBe("abc…");
  });
});
