import { describe, expect, it } from "vitest";
import type { ExtractedName } from "../domain/contract";
import { CHUNK, chunkOf, replayPage, segments } from "./marks";
import {
  activityOf,
  namesPerPage,
  PAGE_READ,
  PAGE_READING,
  PAGE_UNREAD,
  pageMap,
  rangeOf,
  revealable,
} from "./plain";
import { foldEvents, type SeqEvent } from "./run-view";

const start: SeqEvent = {
  seq: 0,
  at: 1000,
  type: "start",
  document: { id: "d", title: "Ledger", pages: 10 },
  source: { kind: "corpus", corpusId: "d" },
  models: {
    analyst: "openai/gpt-6.1-terra",
    reader: "anthropic/claude-haiku-5.5",
  },
  rulebookVersion: 0,
};

const name = (canonical: string, pages: number[]): ExtractedName => ({
  canonical,
  type: "person",
  aliases: [],
  roles: [],
  mentions: pages.map((page) => ({ page, quote: canonical })),
  confidence: 0.9,
  foundBy: ["reader"],
});

describe("rangeOf", () => {
  it("reads input first, then the summary", () => {
    expect(rangeOf({ from: 3, to: 7 })).toEqual({ from: 3, to: 7 });
    expect(rangeOf(undefined, "pages 4-9")).toEqual({ from: 4, to: 9 });
    expect(rangeOf(undefined, "pages 5")).toEqual({ from: 5, to: 5 });
    expect(rangeOf(undefined, "outline")).toBeNull();
  });
});

describe("activityOf", () => {
  it("says what happened in plain words", () => {
    const view = foldEvents([
      start,
      {
        seq: 1,
        at: 1100,
        type: "tool",
        callId: "a",
        tool: "read_pages",
        summary: "pages 1-2",
        input: { from: 1, to: 2 },
        state: "done",
      },
      {
        seq: 2,
        at: 1200,
        type: "tool",
        callId: "b",
        tool: "spawn_readers",
        summary: "2 readers",
        input: {
          ranges: [
            { from: 1, to: 5 },
            { from: 5, to: 10 },
          ],
        },
        state: "start",
      },
      { seq: 3, at: 1300, type: "skill", skill: "alias-resolution" },
      {
        seq: 4,
        at: 1400,
        type: "tool",
        callId: "c",
        tool: "record_names",
        summary: "add 12, merge 3",
        input: {},
        state: "done",
      },
      {
        seq: 5,
        at: 1500,
        type: "tool",
        callId: "d",
        tool: "finish",
        summary: "finish",
        input: {},
        state: "error",
      },
    ]);
    expect(activityOf(view).map((item) => item.text)).toEqual([
      "Read pages 1–2",
      "Sent 2 reader agents across pages 1–10",
      "Loaded the playbook: alias resolution",
      "Added 12 names, merged 3 duplicates",
      "Final check: not done yet, kept going",
    ]);
    expect(activityOf(view)[1].live).toBe(true);
  });
});

describe("pageMap", () => {
  it("marks pages read and being read, reading wins on overlap", () => {
    const view = foldEvents([
      start,
      {
        seq: 1,
        at: 1100,
        type: "reader",
        readerId: "r1",
        from: 1,
        to: 4,
        state: "done",
      },
      {
        seq: 2,
        at: 1200,
        type: "reader",
        readerId: "r2",
        from: 4,
        to: 6,
        state: "start",
      },
    ]);
    const map = pageMap(view, 10);
    expect([...map.state]).toEqual([
      PAGE_READ,
      PAGE_READ,
      PAGE_READ,
      PAGE_READING,
      PAGE_READING,
      PAGE_READING,
      PAGE_UNREAD,
      PAGE_UNREAD,
      PAGE_UNREAD,
      PAGE_UNREAD,
    ]);
    expect(map.reader[4]).toBe(1);
    expect(map.read).toBe(3);
  });
});

describe("namesPerPage", () => {
  it("counts each name once per page", () => {
    const counts = namesPerPage(
      [name("Ana Vos", [1, 1, 2]), name("Bo Li", [2])],
      3,
    );
    expect([...counts]).toEqual([1, 2, 0]);
  });
});

describe("segments", () => {
  it("cuts text at marks and skips overlaps and bad offsets", () => {
    const text = "Paid Ana Vos and Bo Li.";
    const mark = (start: number, end: number) => ({
      start,
      end,
      status: "found" as const,
      name: text.slice(start, end),
      type: "person" as const,
    });
    const parts = segments(text, [
      mark(17, 22),
      mark(5, 12),
      mark(6, 9),
      mark(20, 99),
    ]);
    expect(parts.map((part) => [part.text, Boolean(part.mark)])).toEqual([
      ["Paid ", false],
      ["Ana Vos", true],
      [" and ", false],
      ["Bo Li", true],
      [".", false],
    ]);
    expect(parts.map((part) => part.text).join("")).toBe(text);
  });
});

describe("chunkOf", () => {
  it("aligns to the server's chunk size", () => {
    expect(chunkOf(1, 500)).toEqual({ from: 1, to: CHUNK });
    expect(chunkOf(13, 500)).toEqual({ from: 13, to: 24 });
    expect(chunkOf(499, 500)).toEqual({ from: 493, to: 500 });
  });
});

describe("replayPage", () => {
  it("turns key marks found or missed and finds the run's names", () => {
    const text = "Ana Vos paid Bo Li via Zed Ltd.";
    const page = replayPage(
      {
        page: 1,
        text,
        key: [
          {
            start: 0,
            end: 7,
            status: "expected",
            name: "Ana Vos",
            type: "person",
          },
          {
            start: 13,
            end: 18,
            status: "expected",
            name: "Bo Li",
            type: "person",
          },
        ],
        run: null,
      },
      [name("A. Vos", []), { ...name("Zed Ltd", [1]), type: "organization" }],
      [
        {
          name: "Ana Vos",
          type: "person",
          status: "found",
          foundAs: "A. Vos",
          pages: [1],
          hard: false,
        },
        {
          name: "Bo Li",
          type: "person",
          status: "missed",
          foundAs: null,
          pages: [1],
          hard: true,
        },
        {
          name: "Zed Ltd",
          type: "organization",
          status: "extra",
          foundAs: null,
          pages: [1],
          hard: false,
        },
      ],
    );
    expect(page.key?.map((mark) => mark.status)).toEqual(["found", "missed"]);
    expect(page.run).toEqual([
      {
        start: 23,
        end: 30,
        status: "extra",
        name: "Zed Ltd",
        type: "organization",
      },
    ]);
  });
});

describe("revealable", () => {
  it("shows a name once its first page is read, all once over", () => {
    const pool = [name("Ana Vos", [3, 1]), name("Bo Li", [2])];
    const state = new Uint8Array([PAGE_READ, PAGE_READING, PAGE_UNREAD]);
    expect(
      revealable(pool, state, false).map((item) => item.canonical),
    ).toEqual(["Ana Vos"]);
    expect(revealable(pool, state, true)).toHaveLength(2);
  });
});
