import { describe, expect, it } from "vitest";
import type { ScreenAction } from "../domain/actions";
import type {
  PendingApproval,
  RunDetail,
  RunEvent,
  RunEventInput,
} from "../domain/contract";
import { EMPTY_METRICS } from "../domain/contract";
import { DEFAULT_RULEBOOK } from "../domain/rules";
import {
  activeItemId,
  detailOfView,
  emptyRunView,
  foldEvents,
  groupFindings,
  metAt,
  oneLine,
  pauseAt,
  planAt,
  reduceRunView,
  statusAt,
  viewOfDetail,
} from "./run-view";

const T0 = 1_800_000_000_000;

/** Events with seq and time filled in: one a second, in order. */
function trail(inputs: RunEventInput[]): RunEvent[] {
  return inputs.map((input, seq) => ({ ...input, seq, at: T0 + seq * 1000 }));
}

const start: RunEventInput = {
  type: "start",
  driver: "operator",
  task: { id: "arrival-corvina", title: "Register an arrival", brief: "Do." },
  manifest: { name: "corvina-0412n.csv", rows: 3 },
  model: "anthropic/claude-sonnet-5.5",
  rulebookVersion: 0,
};

function frame(
  n: number,
  turn: number,
  action: ScreenAction | null,
  intent = "",
): RunEventInput {
  return {
    type: "frame",
    n,
    turn,
    action,
    label:
      action === null
        ? "sign-on screen"
        : action.type === "type"
          ? `type "${action.text}"`
          : action.type,
    intent,
    screen: "HMS000",
    pointer: null,
    caret: null,
    changes: [],
    message: "",
    ms: 40,
  };
}

const pending: PendingApproval = {
  approvalId: "ap-1",
  actionKind: "hold.release",
  label: "Release the hold on MRDU4821130",
  change: { op: "update", record: "hold", key: "MRDU4821130" },
  screen: "HMH400",
  key: "key F10",
  frame: 2,
  expiresAt: T0 + 600_000,
};

const typed = (text: string): ScreenAction => ({ type: "type", text });

const base = trail([
  start,
  frame(0, 0, null),
  { type: "thought", turn: 1, text: "Sign on as the clerk.\nThen the menu." },
  frame(1, 1, typed("HM01"), "Sign on as the clerk."),
  {
    type: "cost",
    turn: 1,
    model: "anthropic/claude-sonnet-5.5",
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 0,
    costUsd: 0.01,
    ms: 900,
  },
  { type: "progress", met: [false, false] },
  frame(2, 1, { type: "key", keys: ["Enter"] }, "Sign on as the clerk."),
  { type: "plan", items: [{ text: "Sign on", done: true }] },
  { type: "progress", met: [true, false] },
]);

describe("reduceRunView", () => {
  it("starts the Run and keeps what it was asked", () => {
    const view = foldEvents(base);
    expect(view.status).toBe("running");
    expect(view.driver).toBe("operator");
    expect(view.task?.id).toBe("arrival-corvina");
    expect(view.manifest?.rows).toBe(3);
    expect(view.startedAt).toBe(T0);
    expect(view.lastSeq).toBe(base.length - 1);
  });

  it("groups Frames under their Turn, with the Operator's first line as the intent", () => {
    const view = foldEvents(base);
    expect(view.frames.map((item) => item.n)).toEqual([0, 1, 2]);
    const turns = view.timeline.filter((item) => item.kind === "turn");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turn: 0, frame: 0 });
    expect(turns[0].chips.map((chip) => chip.kind)).toEqual(["start"]);
    expect(turns[1]).toMatchObject({
      turn: 1,
      intent: "Sign on as the clerk.",
      frame: 1,
    });
    expect(turns[1].chips.map((chip) => chip.n)).toEqual([1, 2]);
  });

  it("folds an event once, whatever order or how often it arrives", () => {
    const once = foldEvents(base);
    const twice = foldEvents([...base, ...base]);
    expect(twice).toEqual(once);
    expect(reduceRunView(once, base[3])).toBe(once);
    const late = foldEvents([base[0], base[2], base[1], ...base.slice(3)]);
    expect(late.events.map((event) => event.seq)).toEqual(
      base.map((event) => event.seq),
    );
    expect(late.frames.map((item) => item.n)).toEqual([0, 1, 2]);
  });

  it("only gives the live item a new identity", () => {
    const before = foldEvents(base);
    const [next] = trail([frame(3, 1, typed("x"))]).map((event) => ({
      ...event,
      seq: 50,
    }));
    const after = reduceRunView(before, next);
    expect(after.timeline).toHaveLength(before.timeline.length);
    expect(after.timeline[0]).toBe(before.timeline[0]);
    expect(after.timeline[1]).not.toBe(before.timeline[1]);
  });

  it("starts a new item when the same Turn moves on to another intent", () => {
    const view = foldEvents(
      trail([
        start,
        frame(0, 0, typed("a"), "Key the first row."),
        frame(1, 0, typed("b"), "Key the first row."),
        frame(2, 0, typed("c"), "Key the second row."),
      ]),
    );
    expect(
      view.timeline.map((item) => (item.kind === "turn" ? item.intent : "")),
    ).toEqual(["Key the first row.", "Key the second row."]);
  });

  it("pauses on a guarded Action and runs again after the decision", () => {
    const events = trail([
      ...base,
      {
        type: "rule",
        ruleId: "actions.guarded",
        outcome: "paused",
        reason: "Releasing a hold waits for a person.",
        label: "key F10",
        screen: "HMH400",
        frame: 2,
      },
      { type: "pause", pending },
    ]);
    const paused = foldEvents(events);
    expect(paused.status).toBe("paused");
    expect(paused.pending).toEqual(pending);
    expect(paused.timeline.at(-2)).toMatchObject({
      kind: "rule",
      outcome: "paused",
      frame: 2,
    });
    expect(pauseAt(paused.timeline, 2)?.decision).toBeNull();

    const decided = reduceRunView(paused, {
      type: "decision",
      approvalId: "ap-1",
      decision: "approved",
      seq: events.length,
      at: T0 + 99_000,
    });
    expect(decided.status).toBe("running");
    expect(decided.pending).toBeNull();
    expect(pauseAt(decided.timeline, 2)?.decision).toBe("approved");
    // A Frame after the pause opens a new item below it, in the order things happened.
    const resumed = reduceRunView(decided, {
      ...(frame(3, 1, { type: "key", keys: ["F10"] }) as RunEventInput),
      seq: events.length + 1,
      at: T0 + 100_000,
    } as RunEvent);
    expect(resumed.timeline.at(-1)).toMatchObject({ kind: "turn", turn: 1 });
    expect(resumed.timeline.at(-2)?.kind).toBe("pause");
  });

  it("updates a piece of code in place when it finishes", () => {
    const running: RunEventInput = {
      type: "code",
      callId: "c1",
      code: "print(1)",
      exitCode: -1,
      stdout: "",
      stderr: "",
      ms: 0,
    };
    const view = foldEvents(
      trail([
        start,
        frame(0, 0, null),
        running,
        { ...running, exitCode: 0, stdout: "1\n", ms: 320 },
        { type: "skill", id: "keying-a-manifest", title: "Keying a Manifest" },
        { type: "log", level: "warn", text: "Slow sandbox." },
      ]),
    );
    const cells = view.timeline.filter((item) => item.kind === "code");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ exitCode: 0, stdout: "1\n", frame: 0 });
    expect(view.timeline.map((item) => item.kind)).toEqual([
      "turn",
      "code",
      "skill",
      "log",
    ]);
  });

  it("ends, and takes the checks and the cost that arrive afterwards but nothing else", () => {
    const events = trail([
      ...base,
      { type: "pause", pending },
      { type: "end", status: "stopped", stoppedBy: "cost", summary: "Capped." },
      frame(9, 4, typed("late")),
      {
        type: "findings",
        verdict: "incorrect",
        findings: [{ id: "task.outcome", level: "fail", title: "Missing" }],
      },
    ]);
    const view = foldEvents(events);
    expect(view.status).toBe("stopped");
    expect(view.stoppedBy).toBe("cost");
    expect(view.summary).toBe("Capped.");
    expect(view.pending).toBeNull();
    expect(view.endedAt).toBe(T0 + (base.length + 1) * 1000);
    expect(view.frames.map((item) => item.n)).toEqual([0, 1, 2]);
    expect(view.verdict).toBe("incorrect");
    expect(view.events).toHaveLength(events.length);
  });

  it("takes an `end` that reuses a seq, once", () => {
    const view = foldEvents(base);
    const end: RunEvent = {
      type: "end",
      status: "completed",
      seq: base.length - 1,
      at: T0 + 60_000,
    };
    const ended = reduceRunView(view, end);
    expect(ended.status).toBe("completed");
    expect(reduceRunView(ended, { ...end, status: "failed" })).toBe(ended);
  });
});

describe("what the screen shows at one Frame", () => {
  const view = foldEvents(base);

  it("counts Turns, Actions, cost and time up to the Frame", () => {
    expect(statusAt(view, 0)).toEqual({
      turn: 0,
      actions: 0,
      costUsd: 0,
      elapsedMs: 1000,
    });
    expect(statusAt(view, 2)).toEqual({
      turn: 1,
      actions: 2,
      costUsd: 0.01,
      elapsedMs: 6000,
    });
    expect(statusAt(emptyRunView, 0).actions).toBe(0);
  });

  it("ticks the checklist as code saw it at that Frame", () => {
    expect(metAt(view, 0, 2)).toEqual([false, false]);
    expect(metAt(view, 1, 2)).toEqual([false, false]);
    expect(metAt(view, 2, 2)).toEqual([true, false]);
    // More Expectations than flags: the rest are not met.
    expect(metAt(view, 2, 3)).toEqual([true, false, false]);
  });

  it("shows the plan as it stood", () => {
    expect(planAt(view, 1)).toEqual([]);
    expect(planAt(view, 2)).toEqual([{ text: "Sign on", done: true }]);
  });

  it("finds the item a Frame belongs to", () => {
    const [first, second] = view.timeline;
    expect(activeItemId(view.timeline, 0)).toBe(first.id);
    expect(activeItemId(view.timeline, 2)).toBe(second.id);
    expect(activeItemId(view.timeline, null)).toBeNull();
    expect(activeItemId(view.timeline, 40)).toBe(second.id);
  });
});

describe("a stored Run", () => {
  const detail: RunDetail = {
    id: "run-1",
    driver: "operator",
    taskId: "arrival-corvina",
    title: "Register an arrival",
    brief: "Do.",
    manifestName: "corvina-0412n.csv",
    model: "anthropic/claude-sonnet-5.5",
    status: "paused",
    stoppedBy: null,
    verdict: null,
    error: null,
    costUsd: 0.03,
    metrics: EMPTY_METRICS,
    rulebookVersion: 2,
    startedAt: new Date(T0).toISOString(),
    endedAt: null,
    pending,
    events: base,
    findings: [],
    expected: ["Vessel registered", "Berth allocated"],
    rulebook: DEFAULT_RULEBOOK,
  };

  it("lets the row say what the Trail does not yet", () => {
    const view = viewOfDetail(detail);
    expect(view.status).toBe("paused");
    expect(view.pending).toEqual(pending);
    expect(view.costUsd).toBe(0.03);
    expect(view.frames).toHaveLength(3);
  });

  it("opens with no events at all (a Run by hand)", () => {
    const view = viewOfDetail({
      ...detail,
      driver: "hand",
      status: "completed",
      pending: null,
      events: [],
      verdict: "correct",
      findings: [{ id: "task.outcome", level: "pass", title: "Done" }],
      endedAt: new Date(T0 + 90_000).toISOString(),
    });
    expect(view.status).toBe("completed");
    expect(view.driver).toBe("hand");
    expect(view.verdict).toBe("correct");
    expect(view.findings).toHaveLength(1);
    expect(view.task?.title).toBe("Register an arrival");
    expect((view.endedAt ?? 0) - (view.startedAt ?? 0)).toBe(90_000);
    expect(view.pending).toBeNull();
  });

  it("goes back to a RunDetail that knows what the stream said since", () => {
    const view = foldEvents(
      trail([
        { type: "decision", approvalId: "ap-1", decision: "refused" },
        { type: "findings", verdict: "incorrect", findings: [] },
        { type: "end", status: "completed", stoppedBy: "finish" },
      ]).map((event) => ({ ...event, seq: event.seq + base.length })),
      viewOfDetail(detail),
    );
    const next = detailOfView(detail, view);
    expect(next.status).toBe("completed");
    expect(next.pending).toBeNull();
    expect(next.verdict).toBe("incorrect");
    expect(next.stoppedBy).toBe("finish");
    expect(next.events).toHaveLength(base.length + 3);
    expect(next.expected).toEqual(detail.expected);
    expect(next.endedAt).not.toBeNull();
  });
});

describe("oneLine and groupFindings", () => {
  it("takes the first line that says something", () => {
    expect(oneLine("\n  Open   the menu.\nThen more.")).toBe("Open the menu.");
    expect(oneLine("")).toBe("");
  });

  it("puts what failed first and leaves empty levels out", () => {
    const groups = groupFindings([
      { id: "session.sign-off", level: "pass", title: "Signed off" },
      { id: "task.outcome", level: "fail", title: "Missing" },
      { id: "actions.guarded", level: "info", title: "By hand" },
      { id: "task.outcome", level: "pass", title: "Found" },
    ]);
    expect(groups.map((group) => group.level)).toEqual([
      "fail",
      "pass",
      "info",
    ]);
    expect(groups[1].findings).toHaveLength(2);
  });
});
