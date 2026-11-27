import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { ScreenAction } from "../../domain/actions";
import { EMPTY_METRICS } from "../../domain/contract";
import { DEFAULT_RULEBOOK } from "../../domain/rules";
import { sampleTask } from "../../domain/tasks";
import type { RunContext } from "../context";
import { ScreenUnavailable } from "../errors";
import { callOf, scriptedOperator } from "../operator";
import type { NewRun, RunRow } from "../repository";
import { stubScreen } from "../sandbox/stub-screen";
import { createClientTokenService } from "./clients";
import { createManifestService } from "./manifests";
import { createRulebookService } from "./rulebooks";
import {
  CLIENT_BOOT_MS,
  createRunsService,
  type RunsPorts,
  withDeadline,
} from "./runs";
import { createRunStepsService, type RunStepsService } from "./steps";

/*
 * The Operator's invariants, with fake ports: who may decide an Approval,
 * what happens to one nobody decided in time, one MCP call at a time on a
 * client-driven Run, the caps taken before any work, and the stubbed Screen
 * judging a sample Script with the same Guard and checks as the sandbox.
 * No database, Sandbox or model is touched.
 */

const OWNER = "e2e" as const;
const RUN = "0b8f3c1e-6f7e-4f9a-9a77-1f2d3c4b5a69";
const APPROVAL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const visitor = { hash: "v", trusted: false };

function pending(expiresAt: number) {
  return {
    approvalId: APPROVAL,
    actionKind: "hold.release" as const,
    label: "Release a customs hold (hold on TRSU3304186)",
    change: {
      op: "update" as const,
      record: "hold" as const,
      key: "TRSU3304186",
    },
    screen: "HMH400" as const,
    key: "key Enter",
    frame: 7,
    expiresAt,
  };
}

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN,
    owner: OWNER,
    visitor_hash: "v",
    driver: "client",
    task_id: "release-and-berth",
    title: "Release a hold, book a berth",
    brief: "brief",
    manifest_id: null,
    manifest_name: null,
    model: null,
    rulebook_version: 0,
    rulebook: DEFAULT_RULEBOOK,
    stubbed: false,
    status: "running",
    stopped_by: null,
    verdict: null,
    findings: [],
    metrics: { actions: 3, frames: 4 },
    cost_usd: 0,
    error: null,
    summary: null,
    workflow_run_id: null,
    screen_secret: "secret",
    started_at: new Date(),
    ended_at: null,
    pending: null,
    ...overrides,
  };
}

const claimed = {
  id: APPROVAL,
  run_id: RUN,
  fingerprint: "hold.release:TRSU3304186",
  pending: pending(Date.now() + 60_000),
  status: "approved" as const,
  hook_token: "operator:run:1",
};

const callDone = {
  output: "Done. The Screen now is in the picture.",
  counters: { ...EMPTY_METRICS, costUsd: 0 },
  frame: 4,
  hint: "HMM100",
  diff: null,
  outcome: null,
};

function fakes() {
  const runs = {
    create: vi.fn(
      async (_run: NewRun) =>
        ({ runId: RUN }) as { runId: string } | { refusal: string },
    ),
    owned: vi.fn(async (): Promise<RunRow | null> => row()),
    owns: vi.fn(async () => true),
    get: vi.fn(async (): Promise<RunRow | null> => row()),
    status: vi.fn(async () => "running" as const),
    list: vi.fn(async () => [] as RunRow[]),
    update: vi.fn(async () => {}),
    setWorkflowRun: vi.fn(async () => {}),
    move: vi.fn(async () => true),
    endIfGoing: vi.fn(async () => true),
    countHandSince: vi.fn(async () => 0),
    claimClientCall: vi.fn(async () => true),
    releaseClientCall: vi.fn(async () => {}),
  };
  const approvals = {
    decide: vi.fn(async () => null as typeof claimed | null),
    expirePending: vi.fn(async () => {}),
    pausedMs: vi.fn(async () => 0),
  };
  const steps = {
    begin: vi.fn(),
    turn: vi.fn(),
    runCall: vi.fn(async (..._args: unknown[]) => callDone),
    resumeCall: vi.fn(),
    openApproval: vi.fn(async () => null),
    pause: vi.fn(),
    settle: vi.fn(async () => ({
      decision: "approved" as const,
      active: true,
    })),
    saveCounters: vi.fn(async () => {}),
    note: vi.fn(),
    finish: vi.fn(async () => ({ ended: true, verdict: null })),
    keyed: vi.fn(async () => []),
    dispose: vi.fn(async () => {}),
  };
  const workflow = {
    start: vi.fn(async (_ctx: RunContext) => "wf_1"),
    cancel: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  };
  const ports: RunsPorts = {
    runs,
    trail: { append: vi.fn(async () => {}), after: vi.fn(async () => []) },
    approvals,
    rulebooks: {
      current: vi.fn(async () => ({ version: 0, rulebook: DEFAULT_RULEBOOK })),
    },
    manifests: { owned: vi.fn(async () => null) },
    frames: { get: vi.fn(async () => null) },
    screen: { available: () => true },
    workflow,
    steps: steps as unknown as RunStepsService,
    stub: false,
    now: Date.now,
  };
  return { ports, runs, approvals, steps, workflow };
}

let f: ReturnType<typeof fakes>;
let service: ReturnType<typeof createRunsService>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  f = fakes();
  service = createRunsService(f.ports);
});

describe("deciding an Approval", () => {
  const decide = (by: "person" | "client") =>
    service.decide({
      owner: OWNER,
      runId: RUN,
      approvalId: APPROVAL,
      decision: "approved",
      by,
    });

  it("refuses a client that would approve a Run it drives itself", async () => {
    f.runs.owned.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() + 60_000) }),
    );
    await expect(decide("client")).rejects.toBeInstanceOf(ForbiddenError);
    expect(f.approvals.decide).not.toHaveBeenCalled();
  });

  it("refuses a Run that is not the Owner's, and one not waiting for a decision", async () => {
    f.runs.owned.mockResolvedValueOnce(null);
    await expect(decide("person")).rejects.toBeInstanceOf(NotFoundError);
    f.runs.owned.mockResolvedValueOnce(row({ status: "running" }));
    await expect(decide("person")).rejects.toBeInstanceOf(ConflictError);
    expect(f.approvals.decide).not.toHaveBeenCalled();
  });

  it("lets a person approve a client-driven Run, and tells the Guard through settle", async () => {
    f.runs.owned.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() + 60_000) }),
    );
    f.approvals.decide.mockResolvedValue(claimed);
    await expect(decide("person")).resolves.toEqual({ ok: true });
    expect(f.steps.settle).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN }),
      APPROVAL,
      claimed.fingerprint,
      "approved",
    );
  });

  it("refuses a late decision on a client-driven Run: the harness expires it and refuses the change", async () => {
    f.runs.owned.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() - 1) }),
    );
    f.approvals.decide.mockResolvedValue({
      ...claimed,
      status: "expired",
    } as never);
    await expect(decide("person")).rejects.toThrow(/Too late/);
    // The only write is the expiry: the person's late approval is not recorded.
    expect(f.approvals.decide).toHaveBeenCalledTimes(1);
    expect(f.approvals.decide).toHaveBeenCalledWith(RUN, APPROVAL, "expired");
    expect(f.steps.settle).toHaveBeenCalledWith(
      expect.anything(),
      APPROVAL,
      claimed.fingerprint,
      null,
    );
  });

  it("closes an Operator-driven Run and cancels its workflow when the resume fails", async () => {
    f.runs.owned.mockResolvedValue(
      row({
        driver: "operator",
        status: "paused",
        workflow_run_id: "wf_1",
        pending: pending(Date.now() + 60_000),
      }),
    );
    f.approvals.decide.mockResolvedValue(claimed);
    f.workflow.resume.mockRejectedValue(new Error("hook gone"));
    await expect(decide("person")).rejects.toThrow(/could not be resumed/);
    expect(f.runs.endIfGoing).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({ status: "failed" }),
    );
    expect(f.workflow.cancel).toHaveBeenCalledTimes(1);
    expect(f.steps.dispose).toHaveBeenCalledWith(RUN);
  });
});

describe("a call on a client-driven Run", () => {
  const call = () =>
    service.clientCall(OWNER, RUN, "screen_key", { keys: ["Tab"] });

  it("is refused while another call on the same Run holds it, and does nothing", async () => {
    f.runs.claimClientCall.mockResolvedValue(false);
    await expect(call()).rejects.toThrow(/still going/);
    expect(f.steps.runCall).not.toHaveBeenCalled();
    expect(f.runs.releaseClientCall).not.toHaveBeenCalled();
  });

  it("works from the counters read under its claim, and frees the Run after", async () => {
    f.runs.owned.mockResolvedValue(row({ metrics: { actions: 3 } }));
    // Another call saved 5 Actions between the first read and the claim.
    f.runs.get.mockResolvedValue(row({ metrics: { actions: 5 } }));
    await expect(call()).resolves.toMatchObject({ frame: 4, finished: false });
    expect(f.steps.runCall.mock.calls[0][1]).toMatchObject({ actions: 5 });
    expect(f.runs.releaseClientCall).toHaveBeenCalledWith(RUN);
  });

  it("frees the Run even when the call throws", async () => {
    f.steps.runCall.mockRejectedValue(new Error("database down"));
    await expect(call()).rejects.toThrow("database down");
    expect(f.runs.releaseClientCall).toHaveBeenCalledWith(RUN);
  });

  it("closes the Run when its Screen is gone", async () => {
    f.steps.runCall.mockRejectedValue(new ScreenUnavailable("gone"));
    await expect(call()).rejects.toThrow(/The Run was closed/);
    expect(f.steps.finish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { status: "failed", error: "The Screen sandbox is unavailable." },
      expect.any(Number),
    );
  });

  it("expires an Approval nobody decided in time, then carries on and says so", async () => {
    f.runs.owned.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() - 1) }),
    );
    f.approvals.decide.mockResolvedValue({
      ...claimed,
      status: "expired",
    } as never);
    const answer = await service.clientCall(OWNER, RUN, "screen_capture", {});
    expect(f.steps.settle).toHaveBeenCalledWith(
      expect.anything(),
      APPROVAL,
      claimed.fingerprint,
      null,
    );
    expect(answer.text).toMatch(/^The pending Approval expired/);
  });

  it("stays refused while a person still has time to decide", async () => {
    f.runs.owned.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() + 60_000) }),
    );
    await expect(
      service.clientCall(OWNER, RUN, "screen_capture", {}),
    ).rejects.toThrow(/paused/);
    expect(f.approvals.decide).not.toHaveBeenCalled();
    expect(f.runs.claimClientCall).not.toHaveBeenCalled();
  });

  it("does not count time spent waiting for a person against the Run's time cap", async () => {
    const started = new Date(Date.now() - 20 * 60_000);
    f.runs.owned.mockResolvedValue(row({ started_at: started }));
    f.runs.get.mockResolvedValue(row({ started_at: started }));

    f.approvals.pausedMs.mockResolvedValue(10 * 60_000);
    await service.clientCall(OWNER, RUN, "screen_capture", {});
    expect(f.steps.finish).not.toHaveBeenCalled();
    expect(f.steps.runCall).toHaveBeenCalledTimes(1);

    f.approvals.pausedMs.mockResolvedValue(0);
    await expect(
      service.clientCall(OWNER, RUN, "screen_capture", {}),
    ).rejects.toThrow(/time limit/);
    expect(f.steps.finish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { status: "completed", stoppedBy: "time" },
      started.getTime(),
    );
    expect(f.steps.runCall).toHaveBeenCalledTimes(1);
  });

  it("refuses a Run the in-app Operator drives", async () => {
    f.runs.owned.mockResolvedValue(row({ driver: "operator" }));
    await expect(
      service.clientCall(OWNER, RUN, "screen_capture", {}),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(f.runs.claimClientCall).not.toHaveBeenCalled();
  });
});

describe("caps checked before the work", () => {
  const start = () =>
    service.start(
      { owner: OWNER, visitor },
      {
        task: { kind: "sample", taskId: "release-and-berth" },
        driver: "operator",
      },
    );

  it("a Run refused by its caps starts no workflow and no Screen", async () => {
    f.runs.create.mockResolvedValue({ refusal: "That's 6 in the last hour." });
    await expect(start()).rejects.toBeInstanceOf(LimitError);
    expect(f.workflow.start).not.toHaveBeenCalled();
    expect(f.steps.begin).not.toHaveBeenCalled();
  });

  it("counts a visitor against the caps; the e2e suite is not counted", async () => {
    await start();
    expect(f.runs.create.mock.calls[0][0]).toMatchObject({
      limits: { perVisitorPerHour: 6, activePerOwner: 1 },
      stubbed: false,
      model: "anthropic/claude-sonnet-5.5",
    });
    await service.start(
      { owner: OWNER, visitor: { hash: "e2e", trusted: true } },
      {
        task: { kind: "sample", taskId: "release-and-berth" },
        driver: "operator",
      },
    );
    expect(f.runs.create.mock.calls[1][0]).toMatchObject({ limits: null });
  });

  it("marks a Run the stubbed suite starts, so its steps get the stub adapters, and names no model", async () => {
    const stubbed = createRunsService({ ...f.ports, stub: true });
    await stubbed.start(
      { owner: OWNER, visitor },
      {
        task: { kind: "sample", taskId: "release-and-berth" },
        driver: "operator",
      },
    );
    expect(f.runs.create.mock.calls[0][0]).toMatchObject({
      stubbed: true,
      model: null,
    });
    expect(f.workflow.start.mock.calls[0][0]).toMatchObject({ stubbed: true });
  });

  it("refuses a Manifest that is not the Owner's before anything is written", async () => {
    await expect(
      service.start(
        { owner: OWNER, visitor },
        {
          task: { kind: "own", brief: "Key the attached manifest please." },
          manifestId: APPROVAL,
          driver: "operator",
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(f.runs.create).not.toHaveBeenCalled();
  });

  it("gives up on a Screen that does not boot in time, as a ScreenUnavailable", async () => {
    vi.useFakeTimers();
    try {
      const raced = withDeadline(new Promise<never>(() => {}), CLIENT_BOOT_MS);
      vi.advanceTimersByTime(CLIENT_BOOT_MS);
      await expect(raced).rejects.toBeInstanceOf(ScreenUnavailable);
    } finally {
      vi.useRealTimers();
    }
    // Below the MCP route's maxDuration of 300 s.
    expect(CLIENT_BOOT_MS).toBeLessThan(300_000);
  });

  it("refuses a hand attempt over the hourly cap before replaying it", async () => {
    f.runs.countHandSince.mockResolvedValue(10_000);
    await expect(
      service.fileHand(
        { owner: OWNER, visitor },
        {
          taskId: "release-and-berth",
          inputs: [{ at: 0, action: { type: "key", keys: ["Enter"] } }],
          elapsedMs: 1000,
        },
      ),
    ).rejects.toThrow(/last hour/);
    expect(f.ports.rulebooks.current).not.toHaveBeenCalled();
    expect(f.runs.create).not.toHaveBeenCalled();
  });

  it("an invalid Rulebook is refused before it is stored, and the daily cap is a LimitError", async () => {
    const insert = vi.fn(async () => ({
      refusal: "That's 50 Rulebook versions today.",
    }));
    const rulebooks = createRulebookService({
      current: vi.fn(),
      versions: vi.fn(),
      insert,
    });
    await expect(
      rulebooks.save(
        { owner: OWNER, visitor },
        {
          rulebook: { ...DEFAULT_RULEBOOK, records: { enabled: true, max: 0 } },
        },
      ),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(insert).not.toHaveBeenCalled();
    await expect(
      rulebooks.save({ owner: OWNER, visitor }, { rulebook: DEFAULT_RULEBOOK }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(insert).toHaveBeenCalledWith(OWNER, DEFAULT_RULEBOOK, null, 50);
  });
});

describe("Manifests and MCP tokens", () => {
  it("keeps the file name out of the Storage path: a hashed Owner folder and a server id", async () => {
    const uploadUrl = vi.fn(async () => ({
      signedUrl: "https://s",
      token: "t",
    }));
    const manifests = createManifestService({
      manifests: {
        countSince: vi.fn(async () => 0),
        insert: vi.fn(async () => {}),
        owned: vi.fn(),
        saveRead: vi.fn(),
        fail: vi.fn(),
        list: vi.fn(),
      },
      files: { uploadUrl, download: vi.fn(), pdfText: vi.fn() },
      now: Date.now,
    });
    const slot = await manifests.openUpload(
      { owner: "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c", visitor },
      { name: "../../evil name.CSV", size: 100 },
    );
    expect(slot.path).toMatch(/^manifests\/[0-9a-f]{32}\/[0-9a-f-]{36}\.csv$/);
    expect(uploadUrl).toHaveBeenCalledWith(slot.path);
  });

  it("a Guest's token stops working when the Guest pass is revoked", async () => {
    const pass = {
      id: "6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null as string | null,
      deleted_at: null,
    };
    const clients = createClientTokenService({
      access: {
        guestPass: vi.fn(async () => pass as never),
        hostEmails: () => [],
        e2eEnabled: () => false,
        secret: () => "salt",
      },
      now: Date.now,
    });
    const { token } = clients.mint(
      {
        kind: "guest",
        userId: "u1",
        passId: pass.id,
        label: "x",
        expiresAt: pass.expires_at,
      },
      `guest:${pass.id}`,
      visitor,
    );
    await expect(clients.caller(token)).resolves.toMatchObject({
      owner: `guest:${pass.id}`,
      visitor: { hash: "v", trusted: false },
    });
    pass.revoked_at = new Date().toISOString();
    await expect(clients.caller(token)).resolves.toBeNull();
  });
});

describe("the stubbed Screen", () => {
  /** In-memory stand-ins for the database and the bucket. */
  function stepsOnStub() {
    const approved: string[] = [];
    const steps = createRunStepsService({
      runs: {
        status: async () => "running",
        update: async () => {},
        move: async () => true,
        endIfGoing: async () => true,
      },
      trail: { append: async () => {}, after: async () => [] },
      approvals: {
        insert: async () => {},
        decide: async () => null,
        get: async () => null,
        approvedFingerprints: async () => approved,
        expirePending: async () => {},
      },
      frames: { put: async () => {}, get: async () => null },
      screen: stubScreen,
      code: { run: vi.fn(), dispose: async () => {} },
      operator: scriptedOperator,
      now: Date.now,
    });
    return { steps, approved };
  }

  it("plays a sample Script through the Guard: the guarded key pauses, an approval lets it through, and code says Correct", async () => {
    const { steps, approved } = stepsOnStub();
    const task = sampleTask("release-and-berth");
    if (!task) throw new Error("no sample Task");
    const ctx: RunContext = {
      runId: "stub-run-1",
      driver: "operator",
      taskId: task.id,
      title: task.title,
      brief: task.brief,
      model: null,
      stubbed: true,
      rulebook: DEFAULT_RULEBOOK,
      rulebookVersion: 0,
      secret: "s",
      manifest: null,
    };
    let { counters } = await steps.begin(ctx);
    let paused = 0;
    for (const [turn, planned] of task.script.entries()) {
      for (const [index, action] of planned.actions.entries()) {
        const call = callOf(action, `t${turn}-${index}`);
        const at = { turn: turn + 1, intent: planned.intent };
        const done = await steps.runCall(ctx, counters, at, call, []);
        counters = done.counters;
        const blocked = done.outcome?.blocked;
        // The Rules refuse nothing in a correct Script; they only pause.
        expect(blocked?.decision.kind ?? "pause").toBe("pause");
        if (blocked?.decision.kind === "pause") {
          paused += 1;
          approved.push(blocked.decision.fingerprint);
          await steps.settle(
            ctx,
            "a",
            blocked.decision.fingerprint,
            "approved",
          );
          const resumed = await steps.resumeCall(
            ctx,
            counters,
            at,
            call,
            blocked.applied,
          );
          counters = resumed.counters;
          expect(resumed.outcome).toBeNull();
        }
      }
    }
    expect(paused).toBe(1);
    const ended = await steps.finish(
      ctx,
      counters,
      { status: "completed", stoppedBy: "finish" },
      Date.now(),
    );
    expect(ended.verdict).toBe("correct");
    // The Run's Screen is gone with it.
    await expect(steps.keyed(ctx)).rejects.toBeInstanceOf(ScreenUnavailable);
  }, 20_000);

  it("refuses a key into a closed Screen before HARBOURMASTER sees it", async () => {
    const { steps } = stepsOnStub();
    const ctx = {
      runId: "stub-run-2",
      taskId: "release-and-berth",
      secret: "s",
      rulebook: DEFAULT_RULEBOOK,
    } as RunContext;
    let { counters } = await steps.begin(ctx);
    const at = { turn: 1, intent: "" };
    for (const action of [
      { type: "type", text: "OPR7" },
      { type: "key", keys: ["Tab"] },
      { type: "type", text: "MERIDIA1" },
      { type: "key", keys: ["Enter"] },
      { type: "type", text: "9" },
    ] satisfies ScreenAction[])
      counters = (
        await steps.runCall(ctx, counters, at, callOf(action, "c"), [])
      ).counters;
    const refused = await steps.runCall(
      ctx,
      counters,
      at,
      callOf({ type: "key", keys: ["Enter"] }, "c"),
      [],
    );
    expect(refused.output).toContain("REFUSED by the Rule screens.allowed");
    expect(refused.hint).toContain("HMM100");
    await steps.dispose(ctx.runId);
  });
});
