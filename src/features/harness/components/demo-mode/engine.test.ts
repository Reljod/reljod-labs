import { describe, expect, it, vi } from "vitest";
import {
  type Beat,
  type BeatContext,
  DemoEngine,
  DriftError,
  type Host,
  type Scenario,
  type Settlers,
} from "./engine";

const host = {
  staff: () => ({
    id: "1",
    key: "officer-1",
    name: "Keisha",
    title: "Officer",
    role: "user" as const,
  }),
  controller: async () => {
    throw new Error("no controllers in this test");
  },
} as unknown as Host;

const never = () => new Promise<void>(() => {});

function scenario(beats: Beat[]): Scenario {
  return {
    id: "test",
    title: "Test",
    summary: "",
    features: [],
    minutes: 1,
    asRole: "",
    beats,
  };
}

const beat = (
  id: string,
  run: Beat["run"],
  rest: Partial<Beat> = {},
): Beat => ({
  id,
  say: id,
  run,
  ...rest,
});

const noSettlers: Settlers = {
  "run-started": async () => ({ done: true }),
  "run-quiet": async () => ({ done: true }),
  "run-ended": async () => ({ done: true }),
};

const engineOf = (beats: Beat[], settlers: Settlers = noSettlers, extra = {}) =>
  new DemoEngine(
    { scenario: scenario(beats), host, pollMs: 5, ...extra },
    settlers,
  );

describe("DemoEngine", () => {
  it("walks the happy path, one Beat per press, and finishes", async () => {
    const order: string[] = [];
    const engine = engineOf([
      beat("a", async (ctx) => {
        order.push("a");
        ctx.log("did a");
      }),
      beat("b", async () => {
        order.push("b");
      }),
    ]);
    expect(engine.getState()).toMatchObject({ index: 0, status: "idle" });
    await engine.next();
    expect(order).toEqual(["a"]);
    expect(engine.getState()).toMatchObject({
      index: 1,
      status: "idle",
      finished: false,
    });
    expect(engine.getState().log.map((entry) => entry.text)).toEqual(["did a"]);
    await engine.next();
    expect(engine.getState()).toMatchObject({ index: 2, finished: true });
    await engine.next();
    expect(order).toEqual(["a", "b"]);
  });

  it("goes through running, and tells subscribers", async () => {
    let release = () => {};
    const engine = engineOf([
      beat("a", () => new Promise<void>((resolve) => (release = resolve)), {
        pendingLabel: "Waiting for the Agent…",
      }),
    ]);
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getState().status));
    const pressed = engine.next();
    expect(engine.getState()).toMatchObject({
      status: "running",
      pending: "Waiting for the Agent…",
    });
    release();
    await pressed;
    expect(seen).toContain("running");
    expect(engine.getState().status).toBe("idle");
  });

  it("does not fire a Beat twice when Next is pressed twice", async () => {
    const run = vi.fn(async () => {});
    const engine = engineOf([beat("a", run), beat("b", run)]);
    await Promise.all([engine.next(), engine.next()]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(engine.getState().index).toBe(1);
  });

  it("a rejecting action fails the Beat with the message, and Retry runs it again", async () => {
    let calls = 0;
    const engine = engineOf([
      beat("a", async () => {
        calls += 1;
        if (calls === 1) throw new Error("That's the limit for now.");
      }),
    ]);
    await engine.next();
    expect(engine.getState()).toMatchObject({
      status: "failed",
      problem: "That's the limit for now.",
      index: 0,
    });
    // Next does not move on from a failure; Retry or Skip does.
    await engine.next();
    expect(calls).toBe(1);
    await engine.retry();
    expect(calls).toBe(2);
    expect(engine.getState()).toMatchObject({ status: "idle", finished: true });
  });

  it("Skip leaves a failed Beat undone and goes on", async () => {
    const second = vi.fn(async () => {});
    const engine = engineOf([
      beat("a", async () => {
        throw new Error("Sandbox offline");
      }),
      beat("b", second),
    ]);
    await engine.next();
    engine.skip();
    expect(engine.getState()).toMatchObject({
      index: 1,
      status: "idle",
      problem: null,
    });
    await engine.next();
    expect(second).toHaveBeenCalled();
  });

  it("a settle that never holds times out as drifted, naming why", async () => {
    const settlers: Settlers = {
      ...noSettlers,
      "run-started": async () => ({ done: false, why: "No Run started." }),
    };
    const engine = engineOf(
      [
        beat("a", async () => {}, {
          settle: { kind: "run-started", timeoutMs: 30 },
          onDrift: {
            pipelineId: "member_request",
            askAgain: "Please run it now.",
            start: async () => ({}),
          },
        }),
      ],
      settlers,
    );
    await engine.next();
    expect(engine.getState()).toMatchObject({
      status: "drifted",
      problem: "No Run started.",
      recover: ["ask-again", "start"],
    });
  });

  it("a DriftError from an action is a drift, not a failure", async () => {
    const engine = engineOf([
      beat("a", async () => {
        throw new DriftError("The Run ended without needing an Approval.");
      }),
    ]);
    await engine.next();
    expect(engine.getState().status).toBe("drifted");
  });

  it("Start it for me starts the Run through the host and settles without waiting", async () => {
    const start = vi.fn(async () => ({ id: "run-9" }));
    const settlers: Settlers = {
      ...noSettlers,
      "run-started": async () => ({ done: false, why: "None." }),
    };
    const engine = new DemoEngine(
      {
        scenario: scenario([
          beat("a", async () => {}, {
            settle: { kind: "run-started", timeoutMs: 20 },
            onDrift: {
              pipelineId: "member_request",
              askAgain: "again",
              start: async () => ({ sourceIds: ["s1"] }),
            },
          }),
        ]),
        host: {
          ...host,
          runs: { start },
        } as unknown as Host,
        state: { sessionId: "sess", runId: null, runIds: [], attached: [] },
        pollMs: 5,
      },
      settlers,
    );
    await engine.next();
    expect(engine.getState().status).toBe("drifted");
    await engine.recover("start");
    expect(start).toHaveBeenCalledWith({
      pipelineId: "member_request",
      input: { sourceIds: ["s1"] },
      sessionId: "sess",
      via: "demo",
    });
    expect(engine.getState()).toMatchObject({ finished: true, status: "idle" });
    expect(engine.getState().state.runId).toBe("run-9");
    expect(
      engine.getState().log.some((e) => e.text.includes("guide started")),
    ).toBe(true);
  });

  it("cancel mid-Beat returns to idle and ignores the late result", async () => {
    let finish = () => {};
    let signal: AbortSignal | undefined;
    const engine = engineOf([
      beat("a", (ctx: BeatContext) => {
        signal = ctx.signal;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }),
    ]);
    const pressed = engine.next();
    engine.cancel();
    await pressed;
    expect(signal?.aborted).toBe(true);
    expect(engine.getState()).toMatchObject({ status: "idle", index: 0 });
    finish();
    await Promise.resolve();
    expect(engine.getState()).toMatchObject({ status: "idle", index: 0 });
    // And it can be run again.
    const again = engine.next();
    finish();
    await again;
  });

  it("Skip waiting ends the wait as a drift, leaving the choice to the visitor", async () => {
    const engine = engineOf([beat("a", never)]);
    const pressed = engine.next();
    engine.skipWaiting();
    await pressed;
    expect(engine.getState()).toMatchObject({ status: "drifted", index: 0 });
    expect(engine.getState().problem).toMatch(/stopped waiting/);
    engine.skip();
    expect(engine.getState().finished).toBe(true);
  });

  it("carries state between Beats and resumes at a saved Beat", async () => {
    const engine = engineOf(
      [
        beat("a", async (ctx) => {
          ctx.state.sessionId = "s-1";
        }),
        beat("b", async (ctx) => {
          ctx.log(`in ${ctx.state.sessionId}`);
        }),
      ],
      noSettlers,
      {
        startIndex: 1,
        state: { sessionId: "s-0", runId: null, runIds: [], attached: [] },
      },
    );
    expect(engine.getState().index).toBe(1);
    await engine.next();
    expect(engine.getState().log[0]?.text).toBe("in s-0");
  });

  it("saves after each Beat", async () => {
    const onSave = vi.fn();
    const engine = engineOf([beat("a", async () => {})], noSettlers, {
      onSave,
    });
    await engine.next();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  });

  it("is not affected by a tab change: it holds no reference to any tab", async () => {
    // The engine only sees the host; a host whose controllers change between
    // Beats (a tab unmounting and mounting again) is just a new answer.
    let tab = 0;
    const flaky = {
      ...host,
      controller: async () => ({ tab: ++tab }),
    } as unknown as Host;
    const seen: number[] = [];
    const engine = new DemoEngine(
      {
        scenario: scenario([
          beat("a", async (ctx) => {
            seen.push(
              (
                (await ctx.host.controller("chat")) as unknown as {
                  tab: number;
                }
              ).tab,
            );
          }),
          beat("b", async (ctx) => {
            seen.push(
              (
                (await ctx.host.controller("chat")) as unknown as {
                  tab: number;
                }
              ).tab,
            );
          }),
        ]),
        host: flaky,
      },
      noSettlers,
    );
    await engine.next();
    await engine.next();
    expect(seen).toEqual([1, 2]);
  });
});
