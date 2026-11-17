import { describe, expect, it } from "vitest";
import type { StepSpec } from "../../domain/pipeline";
import { layoutPipeline } from "./layout";
import { PLAY_LEVEL_MS, railOf, type StepState, simulate } from "./progress";

const step = (
  id: string,
  after: string[] = [],
  kind: StepSpec["kind"] = "code",
): StepSpec => ({ id, title: id, kind, after, summary: "" });

const layout = layoutPipeline({
  steps: [
    step("a"),
    step("b", ["a"]),
    step("c", ["a"]),
    step("d", ["b", "c"], "approval"),
  ],
});

describe("level bands", () => {
  it("makes a band only for a level whose Steps run together, with their count", () => {
    expect(layout.levels).toBe(3);
    expect(layout.bands).toHaveLength(1);
    expect(layout.bands[0]).toMatchObject({ level: 1, count: 2 });
  });
});

describe("railOf", () => {
  it("is the Pipeline's shape with no states", () => {
    const rail = railOf(layout, null);
    expect(rail).toMatchObject({
      total: 3,
      label: "3 levels",
      detail: "up to 2 Steps at once",
    });
    expect(rail.segments).toEqual(["idle", "idle", "idle"]);
  });

  it("names the level a Run is at and how many Steps run together", () => {
    const states = new Map<string, StepState>([
      ["a", "done"],
      ["b", "running"],
      ["c", "running"],
      ["d", "pending"],
    ]);
    const rail = railOf(layout, states, "running");
    expect(rail).toMatchObject({
      current: 2,
      total: 3,
      parallel: 2,
      label: "Level 2 of 3",
      detail: "2 Steps at once",
    });
    expect(rail.segments).toEqual(["done", "active", "pending"]);
  });

  it("says when it waits for an Approval, fails, or finishes", () => {
    const waiting = new Map<string, StepState>([
      ["a", "done"],
      ["b", "done"],
      ["c", "done"],
      ["d", "waiting"],
    ]);
    expect(railOf(layout, waiting).detail).toMatch(/Approval/);
    const failed = new Map(waiting).set("c", "failed").set("d", "pending");
    expect(railOf(layout, failed)).toMatchObject({
      current: 2,
      detail: "a Step failed here",
    });
    const all = new Map<string, StepState>(
      ["a", "b", "c", "d"].map((id) => [id, "done" as const]),
    );
    expect(railOf(layout, all).label).toBe("All 3 levels done");
  });
});

describe("simulate", () => {
  it("runs one level at a time, Approval waiting, then everything done", () => {
    const at = (ms: number) => simulate(layout, ms);
    expect(at(0).states.get("a")).toBe("running");
    expect(at(0).states.get("b")).toBe("pending");
    const second = at(PLAY_LEVEL_MS + 10);
    expect(second.states.get("a")).toBe("done");
    expect(second.states.get("b")).toBe("running");
    expect(second.states.get("c")).toBe("running");
    expect(at(2 * PLAY_LEVEL_MS).states.get("d")).toBe("waiting");
    const end = at(3 * PLAY_LEVEL_MS);
    expect(end.finished).toBe(true);
    expect([...end.states.values()].every((s) => s === "done")).toBe(true);
  });

  it("counts elapsed time into the level", () => {
    expect(simulate(layout, 300).elapsed.get("a")).toBe(300);
  });
});
