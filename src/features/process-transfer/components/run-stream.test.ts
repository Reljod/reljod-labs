import { describe, expect, it } from "vitest";
import type { RunView } from "../domain/run";
import { failuresAfter, foldEvent } from "./run-stream";

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

describe("failuresAfter", () => {
  it("counts a clean close that delivered nothing as a failure, so a dead workflow's feed is lost, not followed forever", () => {
    expect(failuresAfter(0, { delivered: 0, threw: false })).toBe(1);
    expect(failuresAfter(3, { delivered: 0, threw: false })).toBe(4);
  });

  it("resets after new lines, and counts a drop after them once", () => {
    expect(failuresAfter(4, { delivered: 12, threw: false })).toBe(0);
    expect(failuresAfter(4, { delivered: 2, threw: true })).toBe(1);
    expect(failuresAfter(2, { delivered: 0, threw: true })).toBe(3);
  });
});
