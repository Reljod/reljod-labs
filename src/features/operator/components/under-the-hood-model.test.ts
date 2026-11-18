import { describe, expect, it } from "vitest";
import {
  EMPTY_METRICS,
  type RunDetail,
  type RunEvent,
  type RunEventInput,
} from "../domain/contract";
import { DEFAULT_RULEBOOK } from "../domain/rules";
import type { Change } from "../legacy/types";
import {
  actionRowsOf,
  codeRunsOf,
  duration,
  firedRulesOf,
  modelCallsOf,
  stopOf,
  tilesOf,
  usd,
} from "./under-the-hood-model";

const T0 = 1_800_000_000_000;

function trail(inputs: RunEventInput[]): RunEvent[] {
  return inputs.map((input, index) => ({
    ...input,
    seq: index + 1,
    at: T0 + index * 1000,
  })) as RunEvent[];
}

const addLine: Change = {
  op: "add",
  record: "line",
  key: "0412N#7",
  after: { container: "MRDU4821131" },
};

const frame = (
  n: number,
  ms: number,
  changes: Change[] = [],
): RunEventInput => ({
  type: "frame",
  n,
  turn: n === 0 ? 0 : 1,
  action: n === 0 ? null : { type: "key", keys: ["Enter"] },
  label: n === 0 ? "sign-on screen" : "key Enter",
  intent: "commit the line",
  screen: "HMC320",
  pointer: null,
  caret: null,
  changes,
  message: "",
  ms,
});

function runWith(
  events: RunEvent[],
  patch: Partial<RunDetail> = {},
): RunDetail {
  return {
    id: "run-1",
    driver: "operator",
    taskId: "release-hold",
    title: "Release a hold",
    brief: "",
    manifestName: null,
    model: "anthropic/claude-sonnet-5.5",
    status: "completed",
    stoppedBy: "finish",
    verdict: "correct",
    error: null,
    costUsd: 0.04213,
    metrics: { ...EMPTY_METRICS, turns: 3, actions: 2, ms: 65_000 },
    rulebookVersion: 2,
    startedAt: new Date(T0).toISOString(),
    endedAt: null,
    pending: null,
    events,
    findings: [],
    expected: [],
    rulebook: DEFAULT_RULEBOOK,
    ...patch,
  };
}

describe("formats", () => {
  it("prints USD to four places and durations in plain units", () => {
    expect(usd(0.04213)).toBe("$0.0421");
    expect(duration(840)).toBe("840 ms");
    expect(duration(12_400)).toBe("12.4 s");
    expect(duration(185_000)).toBe("3 min 05 s");
  });
});

describe("tilesOf", () => {
  it("reads the metrics, the cost, the model, the Rulebook and the driver", () => {
    const tiles = Object.fromEntries(
      tilesOf(runWith([])).map((tile) => [tile.label, tile.value]),
    );
    expect(tiles.Turns).toBe("3");
    expect(tiles.Cost).toBe("$0.0421");
    expect(tiles.Model).toBe("Claude Sonnet 5.5");
    expect(tiles.Rulebook).toBe("v2");
    expect(tiles.Driver).toBe("The Operator");
    expect(tiles["Wall time"]).toBe("1 min 05 s");
  });
});

describe("actionRowsOf", () => {
  it("skips Frame 0, marks the slowest Action and names what it committed", () => {
    const rows = actionRowsOf(
      trail([frame(0, 0), frame(1, 120), frame(2, 900, [addLine]), frame(3, 300)]),
    );
    expect(rows.map((row) => row.n)).toEqual([1, 2, 3]);
    expect(rows.filter((row) => row.slowest).map((row) => row.n)).toEqual([2]);
    expect(rows[1].committed).toEqual([
      "Add a manifest line (manifest line 0412N#7)",
    ]);
    expect(rows[0].committed).toEqual([]);
  });
});

describe("modelCallsOf", () => {
  it("gives each call its share of the slowest call", () => {
    const calls = modelCallsOf(
      trail([
        {
          type: "cost",
          turn: 1,
          model: "anthropic/claude-sonnet-5.5",
          inputTokens: 1000,
          outputTokens: 100,
          cachedInputTokens: 800,
          costUsd: 0.001,
          ms: 2000,
        },
        {
          type: "cost",
          turn: 2,
          model: "anthropic/claude-sonnet-5.5",
          inputTokens: 1200,
          outputTokens: 80,
          cachedInputTokens: 1000,
          costUsd: 0.001,
          ms: 1000,
        },
      ]),
    );
    expect(calls.map((call) => call.share)).toEqual([1, 0.5]);
  });
});

describe("firedRulesOf", () => {
  it("pairs a pause with its decision and says how long the person took", () => {
    const events = trail([
      {
        type: "rule",
        ruleId: "fields.protected",
        outcome: "refused",
        reason: "line.container is a protected field",
        label: "key Enter",
        screen: "HMC320",
        frame: 4,
      },
      {
        type: "rule",
        ruleId: "actions.guarded",
        outcome: "paused",
        reason: "Release a customs hold (hold on MRDU4821131) needs a person.",
        label: "key F10",
        screen: "HMH400",
        frame: 7,
      },
      {
        type: "pause",
        pending: {
          approvalId: "ap-1",
          actionKind: "hold.release",
          label: "Release a customs hold",
          change: { op: "update", record: "hold", key: "MRDU4821131" },
          screen: "HMH400",
          key: "key F10",
          frame: 7,
          expiresAt: T0 + 600_000,
        },
      },
      { type: "log", level: "info", text: "waiting" },
      { type: "decision", approvalId: "ap-1", decision: "approved" },
      {
        type: "rule",
        ruleId: "actions.guarded",
        outcome: "paused",
        reason: "Delete a manifest line needs a person.",
        label: "key F10",
        screen: "HMC310",
        frame: 9,
      },
    ]);
    const fired = firedRulesOf(events);
    expect(fired.map((rule) => rule.title)).toEqual([
      "Fields it may never change",
      "Actions that need a person",
      "Actions that need a person",
    ]);
    expect(fired[0].pause).toBeNull();
    // The pause is event 3, the decision event 5: two seconds apart.
    expect(fired[1].pause).toEqual({
      decision: "approved",
      note: undefined,
      waitedMs: 2000,
    });
    expect(fired[2].pause).toEqual({ decision: "waiting", waitedMs: null });
  });
});

describe("stopOf", () => {
  it("marks the cap that ended the Run", () => {
    const stop = stopOf(
      runWith([], {
        status: "stopped",
        stoppedBy: "turns",
        metrics: { ...EMPTY_METRICS, turns: 40 },
      }),
    );
    expect(stop.headline).toMatch(/Turn cap \(40/);
    expect(stop.caps.filter((cap) => cap.hit).map((cap) => cap.label)).toEqual(
      ["Turns"],
    );
    expect(stop.caps[0].share).toBe(1);
  });

  it("falls back to the end event and shows the error", () => {
    const stop = stopOf(
      runWith(
        trail([
          { type: "end", status: "failed", error: "Sandbox unavailable" },
        ]),
        { status: "failed", stoppedBy: null },
      ),
    );
    expect(stop.headline).toBe("Failed before the driver finished.");
    expect(stop.detail).toBe("Sandbox unavailable");
  });
});

describe("codeRunsOf", () => {
  it("keeps the latest state of each call", () => {
    const code = (exitCode: number, stdout: string): RunEventInput => ({
      type: "code",
      callId: "c1",
      code: "console.log(1)",
      exitCode,
      stdout,
      stderr: "",
      ms: 0,
    });
    const runs = codeRunsOf(trail([code(-1, ""), code(0, "1\n")]));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ running: false, stdout: "1\n" });
  });
});
