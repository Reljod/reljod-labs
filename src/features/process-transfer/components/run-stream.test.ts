import { describe, expect, it } from "vitest";
import type { RunView } from "../domain/run";
import {
  backoff,
  failuresAfter,
  finished,
  foldEvent,
  parseEvent,
  takeLines,
  waitBefore,
} from "./run-stream";

describe("takeLines", () => {
  it("keeps the unfinished tail for the next chunk", () => {
    const first = takeLines("", '{"type":"log"}\n{"type":');
    expect(first.lines).toEqual(['{"type":"log"}']);
    expect(first.rest).toBe('{"type":');
    const second = takeLines(first.rest, '"end"}\n\n');
    expect(second.lines).toEqual(['{"type":"end"}']);
    expect(second.rest).toBe("");
  });
});

describe("parseEvent", () => {
  it("skips lines that are not events", () => {
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent("42")).toBeNull();
    expect(parseEvent('{"at":1,"type":"end","status":"completed"}')).toEqual({
      at: 1,
      type: "end",
      status: "completed",
    });
  });
});

describe("finished and backoff", () => {
  it("stops only on a closing end", () => {
    expect(finished(null)).toBe(false);
    expect(finished({ at: 1, type: "log", level: "info", text: "x" })).toBe(
      false,
    );
    expect(finished({ at: 1, type: "end", status: "completed" })).toBe(true);
  });

  it("backs off and caps", () => {
    expect([0, 1, 2, 3, 6].map(backoff)).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
  });
});

describe("foldEvent", () => {
  it("does not add a log line the saved Run already has", () => {
    const run = {
      logs: [{ at: 5, level: "info", text: "Watching" }],
      calls: [],
    } as unknown as RunView;
    const same = foldEvent(run, {
      at: 5,
      type: "log",
      level: "info",
      text: "Watching",
    });
    expect(same.logs).toHaveLength(1);
    const next = foldEvent(run, {
      at: 6,
      type: "log",
      level: "info",
      text: "Writing",
    });
    expect(next.logs.map((line) => line.text)).toEqual(["Watching", "Writing"]);
  });
});

describe("failuresAfter and waitBefore", () => {
  it("counts a clean close that delivered nothing as a failure", () => {
    expect(failuresAfter(0, { delivered: 0, threw: false })).toBe(1);
    expect(failuresAfter(3, { delivered: 0, threw: false })).toBe(4);
  });

  it("resets after new lines, and counts a drop after them once", () => {
    expect(failuresAfter(4, { delivered: 12, threw: false })).toBe(0);
    expect(failuresAfter(4, { delivered: 2, threw: true })).toBe(1);
    expect(failuresAfter(2, { delivered: 0, threw: true })).toBe(3);
  });

  it("backs off once anything fails", () => {
    expect(waitBefore(0)).toBe(300);
    expect(waitBefore(1)).toBe(1000);
    expect(waitBefore(3)).toBe(4000);
  });
});
