import { describe, expect, it } from "vitest";
import type { RunEvent, RunEventInput, RunView } from "../../domain/run";
import { backoffMs, type RunSource, RunStore, runProgress } from "./run-store";

const at = (second: number) =>
  `2026-11-17T09:00:${String(second).padStart(2, "0")}.000Z`;

const pending = (stepId: string) => ({
  stepId,
  status: "pending" as const,
  startedAt: null,
  finishedAt: null,
  output: null,
  error: null,
  usage: null,
});

const base = (id: string, status: RunView["status"] = "queued"): RunView => ({
  id,
  pipelineId: "member_request",
  sessionId: null,
  status,
  subject: "x",
  startedBy: { id: "s1", name: "S" },
  startedVia: "app",
  createdAt: at(0),
  updatedAt: at(0),
  finishedAt: null,
  input: {},
  result: null,
  error: null,
  ruleVersions: {},
  steps: [pending("a"), pending("b")],
  findings: [],
  approvals: [],
  drafts: [],
});

const ev = (seq: number, body: RunEventInput) =>
  ({ ...body, seq, at: at(seq) }) as RunEvent;

const script = (id: string): RunEvent[] => [
  ev(0, { type: "run.started", run: base(id) }),
  ev(1, { type: "step.started", stepId: "a" }),
  ev(2, {
    type: "step.finished",
    stepId: "a",
    status: "done",
    output: null,
    usage: null,
  }),
  ev(3, { type: "step.started", stepId: "b" }),
  ev(4, {
    type: "step.finished",
    stepId: "b",
    status: "done",
    output: null,
    usage: null,
  }),
  ev(5, {
    type: "run.finished",
    status: "completed",
    result: null,
    error: null,
  }),
];

const instant = () => Promise.resolve();

function fakeSource(
  runs: Record<string, RunView>,
  streams: Record<string, (from: number) => AsyncIterable<RunEvent>>,
) {
  const calls: { get: string[]; events: [string, number][] } = {
    get: [],
    events: [],
  };
  const source: RunSource = {
    async get(id) {
      calls.get.push(id);
      const run = runs[id];
      if (!run) throw Object.assign(new Error("Not found"), { status: 404 });
      return run;
    },
    events(id, from) {
      calls.events.push([id, from]);
      const make = streams[id];
      if (!make) throw new Error("no stream");
      return make(from);
    },
  };
  return { source, calls };
}

async function* from(events: RunEvent[], start: number, then?: Error) {
  for (const event of events.filter((item) => item.seq >= start)) yield event;
  if (then) throw then;
}

describe("backoffMs and runProgress", () => {
  it("backs off 1, 2, 4 … up to 15 seconds", () => {
    expect([0, 1, 2, 3, 10].map(backoffMs)).toEqual([
      1000, 2000, 4000, 8000, 15_000,
    ]);
  });

  it("only grows as a Run goes forward", () => {
    const run = base("r");
    const next = {
      ...run,
      steps: [
        { ...pending("a"), status: "running" as const },
        ...run.steps.slice(1),
      ],
    };
    expect(runProgress(next)).toBeGreaterThan(runProgress(run));
    expect(runProgress({ ...next, status: "completed" })).toBeGreaterThan(
      runProgress(next),
    );
  });
});

describe("RunStore", () => {
  it("reads a Run that has ended from get alone", async () => {
    const done = { ...base("r1", "completed"), finishedAt: at(9) };
    const { source, calls } = fakeSource({ r1: done }, {});
    const store = new RunStore(source, { sleep: instant });
    store.open("r1");
    const watch = await store.whenLoaded("r1");
    expect(watch?.run?.status).toBe("completed");
    expect(watch?.state).toBe("ended");
    expect(calls.events).toEqual([]);
  });

  it("follows a live Run to its end without drawing it going backwards", async () => {
    const events = script("r1");
    // get already shows Step a finished.
    const snapshot: RunView = {
      ...base("r1", "running"),
      steps: [{ ...pending("a"), status: "done" }, pending("b")],
    };
    const { source } = fakeSource(
      { r1: snapshot },
      { r1: (start) => from(events, start) },
    );
    const store = new RunStore(source, { sleep: instant });
    const seen: string[] = [];
    store.subscribe(() => {
      const watch = store.get("r1");
      if (watch?.run)
        seen.push(watch.run.steps.map((s) => s.status[0]).join(""));
    });
    store.open("r1");
    store.open("r1");
    await store.whenLoaded("r1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const final = store.get("r1");
    expect(final?.state).toBe("ended");
    expect(final?.run?.status).toBe("completed");
    // Step a was never shown pending again after the snapshot.
    const afterSnapshot = seen.slice(seen.indexOf("dp"));
    expect(afterSnapshot.some((entry) => entry.startsWith("p"))).toBe(false);
  });

  it("reconnects from the last event after the stream drops", async () => {
    const events = script("r1");
    let attempt = 0;
    const { source, calls } = fakeSource(
      { r1: base("r1", "running") },
      {
        r1: (start) => {
          attempt += 1;
          return attempt === 1
            ? from(events.slice(0, 3), start, new Error("network"))
            : from(events, start);
        },
      },
    );
    const store = new RunStore(source, { sleep: instant });
    store.open("r1");
    for (let i = 0; i < 50 && store.get("r1")?.state !== "ended"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(store.get("r1")?.run?.status).toBe("completed");
    expect(calls.events.map((call) => call[1])).toEqual([0, 3]);
  });

  it("gives up after too many drops and offers a retry", async () => {
    const { source } = fakeSource(
      { r1: base("r1", "running") },
      { r1: () => from([], 0, new Error("down")) },
    );
    const store = new RunStore(source, { sleep: instant });
    store.open("r1");
    for (let i = 0; i < 100 && store.get("r1")?.state !== "error"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(store.get("r1")?.state).toBe("error");
    expect(store.get("r1")?.gone).toBe(false);
  });

  it("marks a Run that is not there as gone", async () => {
    const { source } = fakeSource({}, {});
    const store = new RunStore(source, { sleep: instant });
    store.open("nope");
    const watch = await store.whenLoaded("nope");
    expect(watch).toMatchObject({ state: "error", gone: true });
  });

  it("keeps several Runs live at once", async () => {
    const one = script("r1");
    const two = script("r2");
    const { source } = fakeSource(
      { r1: base("r1", "running"), r2: base("r2", "running") },
      { r1: (s) => from(one, s), r2: (s) => from(two, s) },
    );
    const store = new RunStore(source, { sleep: instant });
    store.open("r1");
    store.open("r2");
    for (let i = 0; i < 50; i++) {
      if (
        store.get("r1")?.state === "ended" &&
        store.get("r2")?.state === "ended"
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(store.get("r1")?.run?.status).toBe("completed");
    expect(store.get("r2")?.run?.status).toBe("completed");
  });

  it("adopts the Run a write returned", () => {
    const { source } = fakeSource({}, {});
    const store = new RunStore(source, { sleep: instant });
    store.adopt({ ...base("r9", "completed"), updatedAt: at(8) });
    expect(store.get("r9")?.run?.status).toBe("completed");
    expect(store.get("r9")?.state).toBe("ended");
    // An older copy does not replace a newer one.
    store.adopt({ ...base("r9", "running"), updatedAt: at(1) });
    expect(store.get("r9")?.run?.status).toBe("completed");
  });
});
