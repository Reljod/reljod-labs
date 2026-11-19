import { describe, expect, it } from "vitest";
import { EMPTY_METRICS, type RunSummary } from "../domain/contract";
import { operatorRunFor, timesSlower } from "./compare";

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: "r",
  driver: "operator",
  taskId: "arrival-corvina",
  title: "Task",
  brief: "",
  manifestName: null,
  model: null,
  status: "completed",
  stoppedBy: "finish",
  verdict: "correct",
  error: null,
  costUsd: 0,
  metrics: EMPTY_METRICS,
  rulebookVersion: 0,
  startedAt: "2026-11-18T00:00:00Z",
  endedAt: "2026-11-18T00:01:00Z",
  pending: null,
  ...over,
});

describe("operatorRunFor", () => {
  const recorded = run({ id: "recorded", replay: true });

  it("prefers the Owner's latest finished Operator Run of the Task", () => {
    const runs = [
      run({ id: "hand", driver: "hand" }),
      run({ id: "going", status: "running", verdict: null }),
      run({ id: "other", taskId: "hold-release" }),
      run({ id: "mine" }),
      run({ id: "older" }),
    ];
    expect(operatorRunFor("arrival-corvina", runs, recorded)?.id).toBe("mine");
  });

  it("falls back to the recorded Run of the same Task only", () => {
    expect(operatorRunFor("arrival-corvina", [], recorded)?.id).toBe(
      "recorded",
    );
    expect(operatorRunFor("hold-release", [], recorded)).toBeNull();
    expect(operatorRunFor(null, [run({})], recorded)).toBeNull();
  });
});

describe("timesSlower", () => {
  it("is a ratio of the two times, whichever is longer", () => {
    expect(timesSlower(240_000, 100_000)).toBe(2.4);
    expect(timesSlower(100_000, 240_000)).toBe(2.4);
    expect(timesSlower(0, 100)).toBeNull();
  });
});
