import { describe, expect, it } from "vitest";
import type { RunEvent } from "../domain/run-events";
import { emptyRun, isOver, reduceRun } from "./run-reducer";

const play = (events: RunEvent[]) => events.reduce(reduceRun, emptyRun);

const started: RunEvent[] = [
  {
    at: 1000,
    type: "plan",
    pipeline: null,
    jobs: ["sort", "read"],
    inferred: false,
  },
  { at: 1100, type: "job", index: 0, job: "sort", state: "done" },
  { at: 1200, type: "job", index: 1, job: "read", state: "start" },
];

describe("reduceRun", () => {
  it("marks the job in flight as stopped when the Run is stopped", () => {
    const view = play([
      ...started,
      { at: 2000, type: "end", status: "stopped" },
    ]);
    expect(view.status).toBe("stopped");
    expect(isOver(view)).toBe(true);
    expect(view.jobs.map((item) => item.state)).toEqual(["done", "stopped"]);
  });

  it("ignores what a stopped Run's last model call reports afterwards", () => {
    const view = play([
      ...started,
      { at: 2000, type: "end", status: "stopped" },
      {
        at: 2500,
        type: "cost",
        purpose: "read",
        model: "m",
        costUsd: 1,
        inputTokens: 1,
        outputTokens: 1,
        ms: 1,
      },
      { at: 2600, type: "job", index: 1, job: "read", state: "done" },
    ]);
    expect(view.costUsd).toBe(0);
    expect(view.jobs[1].state).toBe("stopped");
    expect(view.status).toBe("stopped");
  });

  it("keeps the first and latest event times for the Run's duration", () => {
    const view = play(started);
    expect(view.startedAt).toBe(1000);
    expect(view.lastAt).toBe(1200);
  });
});
