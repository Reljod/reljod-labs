import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * The Run service's decision paths, with the database, the sandboxes and the
 * workflow mocked: who may decide an Approval, what happens to one nobody
 * decided in time, one MCP call at a time on a client-driven Run, and the
 * caps that are checked before any work. No Sandbox or database is touched.
 */

const repo = vi.hoisted(() => ({
  claimClientCall: vi.fn(),
  countHandRunsSince: vi.fn(),
  createRun: vi.fn(),
  currentRulebook: vi.fn(),
  decideApprovalRow: vi.fn(),
  endRunIfGoing: vi.fn(),
  expirePending: vi.fn(),
  getRunRow: vi.fn(),
  insertEvents: vi.fn(),
  ownedManifest: vi.fn(),
  ownedRun: vi.fn(),
  pausedMsOf: vi.fn(),
  releaseClientCall: vi.fn(),
  setWorkflowRun: vi.fn(),
}));
const steps = vi.hoisted(() => ({
  begin: vi.fn(),
  runCall: vi.fn(),
  saveCounters: vi.fn(),
  settle: vi.fn(),
}));
const flow = vi.hoisted(() => ({
  cancel: vi.fn(),
  resumeHook: vi.fn(),
  start: vi.fn(),
}));
const finish = vi.hoisted(() => ({ finishRun: vi.fn() }));

vi.mock("./repository", async () => {
  const { EMPTY_METRICS } = await import("../domain/contract");
  const { DEFAULT_RULEBOOK } = await import("../domain/rules");
  return {
    ...repo,
    metricsOf: (row: { metrics?: object }) => ({
      ...EMPTY_METRICS,
      ...(row.metrics ?? {}),
    }),
    runRulebook: () => DEFAULT_RULEBOOK,
  };
});
vi.mock("./run-steps", () => steps);
vi.mock("./finish", () => finish);
vi.mock("workflow/api", () => ({
  getRun: () => ({ cancel: flow.cancel }),
  resumeHook: flow.resumeHook,
  start: flow.start,
}));
vi.mock("./run-workflow", () => ({ operatorRun: () => {} }));
vi.mock("./act", () => ({
  frameHint: () => "HMM100",
  openApproval: vi.fn(),
}));
vi.mock("./emit", () => ({ emit: vi.fn(async () => {}) }));
vi.mock("./env", () => ({ env: { sandboxConfigured: () => true } }));
vi.mock("./code-sandbox", () => ({ disposeCode: vi.fn(async () => {}) }));
vi.mock("./screen", () => {
  class ScreenUnavailable extends Error {
    constructor() {
      super("The Screen sandbox is unavailable.");
      this.name = "ScreenUnavailable";
    }
  }
  return {
    ScreenUnavailable,
    disposeScreen: vi.fn(async () => {}),
    screenBooks: vi.fn(async () => ({ diff: [] })),
  };
});

import {
  CLIENT_BOOT_MS,
  clientCall,
  decideApproval,
  submitHandRun,
  withDeadline,
} from "./runs";
import { ScreenUnavailable } from "./screen";

const OWNER = "e2e" as const;
const RUN = "0b8f3c1e-6f7e-4f9a-9a77-1f2d3c4b5a69";
const APPROVAL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function pending(expiresAt: number) {
  return {
    approvalId: APPROVAL,
    actionKind: "hold.release",
    label: "Release a customs hold (hold on TRSU3304186)",
    change: { op: "update", record: "hold", key: "TRSU3304186" },
    screen: "HMH400",
    key: "key Enter",
    frame: 7,
    expiresAt,
  };
}

function row(overrides: Record<string, unknown> = {}) {
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
    rulebook: {},
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
  status: "approved",
  hook_token: "operator:run:1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  repo.pausedMsOf.mockResolvedValue(0);
  repo.claimClientCall.mockResolvedValue(true);
  repo.releaseClientCall.mockResolvedValue(undefined);
  repo.endRunIfGoing.mockResolvedValue(true);
  repo.insertEvents.mockResolvedValue(undefined);
  repo.ownedManifest.mockResolvedValue(null);
  steps.settle.mockResolvedValue({ decision: "approved", active: true });
  steps.saveCounters.mockResolvedValue(undefined);
  flow.cancel.mockResolvedValue(undefined);
});

describe("deciding an Approval", () => {
  const decide = (by: "person" | "client", decision = "approved" as const) =>
    decideApproval({
      owner: OWNER,
      runId: RUN,
      approvalId: APPROVAL,
      decision,
      by,
    });

  it("refuses a client that would approve a Run it drives itself", async () => {
    repo.ownedRun.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() + 60_000) }),
    );
    const answer = await decide("client");
    expect(answer).toHaveProperty("error");
    expect(repo.decideApprovalRow).not.toHaveBeenCalled();
  });

  it("refuses a decision on a Run that is not waiting for one", async () => {
    repo.ownedRun.mockResolvedValue(row({ status: "running" }));
    expect(await decide("person")).toEqual({
      error: "This Run is not waiting for a decision.",
    });
    expect(repo.decideApprovalRow).not.toHaveBeenCalled();
  });

  it("refuses a Run that is not the Owner's", async () => {
    repo.ownedRun.mockResolvedValue(null);
    expect(await decide("person")).toEqual({ error: "No such Run." });
  });

  it("lets a person approve a client-driven Run, and tells the Guard through settle", async () => {
    repo.ownedRun.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() + 60_000) }),
    );
    repo.decideApprovalRow.mockResolvedValue(claimed);
    expect(await decide("person")).toEqual({ ok: true });
    expect(repo.decideApprovalRow).toHaveBeenCalledWith(
      RUN,
      APPROVAL,
      "approved",
    );
    expect(steps.settle).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN }),
      APPROVAL,
      claimed.fingerprint,
      "approved",
    );
  });

  it("refuses a late decision on a client-driven Run: the harness expires it and refuses the change", async () => {
    repo.ownedRun.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() - 1) }),
    );
    repo.decideApprovalRow.mockResolvedValue({ ...claimed, status: "expired" });
    const answer = await decide("person");
    expect(answer).toHaveProperty("error");
    expect((answer as { error: string }).error).toMatch(/Too late/);
    // The only write is the expiry: the person's late approval is not recorded.
    expect(repo.decideApprovalRow).toHaveBeenCalledTimes(1);
    expect(repo.decideApprovalRow).toHaveBeenCalledWith(
      RUN,
      APPROVAL,
      "expired",
    );
    expect(steps.settle).toHaveBeenCalledWith(
      expect.anything(),
      APPROVAL,
      claimed.fingerprint,
      null,
    );
  });

  it("closes an Operator-driven Run and cancels its workflow when the resume fails", async () => {
    repo.ownedRun.mockResolvedValue(
      row({
        driver: "operator",
        status: "paused",
        workflow_run_id: "wf_1",
        pending: pending(Date.now() + 60_000),
      }),
    );
    repo.decideApprovalRow.mockResolvedValue(claimed);
    flow.resumeHook.mockRejectedValue(new Error("hook gone"));
    const answer = await decide("person");
    expect(answer).toEqual({
      error: "The Run could not be resumed after the decision.",
    });
    expect(repo.endRunIfGoing).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({ status: "failed" }),
    );
    expect(flow.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("a call on a client-driven Run", () => {
  const done = {
    output: "Done. The Screen now is in the picture.",
    counters: {},
    frame: 4,
    hint: "HMM100",
    diff: null,
    outcome: null,
  };

  it("is refused while another call on the same Run holds it, and does nothing", async () => {
    repo.ownedRun.mockResolvedValue(row());
    repo.claimClientCall.mockResolvedValue(false);
    const answer = await clientCall(OWNER, RUN, "screen_key", {
      keys: ["Tab"],
    });
    expect(answer).toHaveProperty("error");
    expect((answer as { error: string }).error).toMatch(/still going/);
    expect(steps.runCall).not.toHaveBeenCalled();
    expect(repo.releaseClientCall).not.toHaveBeenCalled();
  });

  it("works from the counters read under its claim, and frees the Run after", async () => {
    repo.ownedRun.mockResolvedValue(row({ metrics: { actions: 3 } }));
    // Another call saved 5 Actions between the first read and the claim.
    repo.getRunRow.mockResolvedValue(row({ metrics: { actions: 5 } }));
    steps.runCall.mockResolvedValue({ ...done, counters: { actions: 6 } });
    const answer = await clientCall(OWNER, RUN, "screen_key", {
      keys: ["Tab"],
    });
    expect(answer).toMatchObject({ frame: 4, finished: false });
    expect(steps.runCall.mock.calls[0][1]).toMatchObject({ actions: 5 });
    expect(repo.releaseClientCall).toHaveBeenCalledWith(RUN);
  });

  it("frees the Run even when the call throws", async () => {
    repo.ownedRun.mockResolvedValue(row());
    repo.getRunRow.mockResolvedValue(row());
    steps.runCall.mockRejectedValue(new Error("database down"));
    await expect(
      clientCall(OWNER, RUN, "screen_key", { keys: ["Tab"] }),
    ).rejects.toThrow("database down");
    expect(repo.releaseClientCall).toHaveBeenCalledWith(RUN);
  });

  it("expires an Approval nobody decided in time, then carries on and says so", async () => {
    repo.ownedRun.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() - 1) }),
    );
    repo.decideApprovalRow.mockResolvedValue({ ...claimed, status: "expired" });
    repo.getRunRow.mockResolvedValue(row({ status: "running" }));
    steps.runCall.mockResolvedValue(done);
    const answer = await clientCall(OWNER, RUN, "screen_capture", {});
    expect(repo.decideApprovalRow).toHaveBeenCalledWith(
      RUN,
      APPROVAL,
      "expired",
    );
    expect(steps.settle).toHaveBeenCalledWith(
      expect.anything(),
      APPROVAL,
      claimed.fingerprint,
      null,
    );
    expect((answer as { text: string }).text).toMatch(
      /^The pending Approval expired/,
    );
  });

  it("stays refused while a person still has time to decide", async () => {
    repo.ownedRun.mockResolvedValue(
      row({ status: "paused", pending: pending(Date.now() + 60_000) }),
    );
    const answer = await clientCall(OWNER, RUN, "screen_capture", {});
    expect((answer as { error: string }).error).toMatch(/paused/);
    expect(repo.decideApprovalRow).not.toHaveBeenCalled();
    expect(repo.claimClientCall).not.toHaveBeenCalled();
  });

  it("does not count time spent waiting for a person against the Run's time cap", async () => {
    const started = new Date(Date.now() - 20 * 60_000);
    repo.ownedRun.mockResolvedValue(row({ started_at: started }));
    repo.getRunRow.mockResolvedValue(row({ started_at: started }));
    steps.runCall.mockResolvedValue(done);

    repo.pausedMsOf.mockResolvedValue(10 * 60_000);
    await clientCall(OWNER, RUN, "screen_capture", {});
    expect(finish.finishRun).not.toHaveBeenCalled();
    expect(steps.runCall).toHaveBeenCalledTimes(1);

    repo.pausedMsOf.mockResolvedValue(0);
    const answer = await clientCall(OWNER, RUN, "screen_capture", {});
    expect(finish.finishRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { status: "completed", stoppedBy: "time" },
      started.getTime(),
    );
    expect(answer).toHaveProperty("error");
  });

  it("refuses a Run the in-app Operator drives", async () => {
    repo.ownedRun.mockResolvedValue(row({ driver: "operator" }));
    const answer = await clientCall(OWNER, RUN, "screen_capture", {});
    expect(answer).toHaveProperty("error");
    expect(repo.claimClientCall).not.toHaveBeenCalled();
  });
});

describe("caps checked before the work", () => {
  it("gives up on a Screen that does not boot in time, as a ScreenUnavailable", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => {});
      const raced = withDeadline(never, CLIENT_BOOT_MS);
      vi.advanceTimersByTime(CLIENT_BOOT_MS);
      await expect(raced).rejects.toBeInstanceOf(ScreenUnavailable);
    } finally {
      vi.useRealTimers();
    }
    // Below the MCP route's maxDuration of 300 s.
    expect(CLIENT_BOOT_MS).toBeLessThan(300_000);
  });

  it("passes the work's own answer through", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("refuses a hand attempt over the hourly cap before replaying it", async () => {
    repo.countHandRunsSince.mockResolvedValue(10_000);
    const answer = await submitHandRun({
      owner: OWNER,
      visitor: { hash: "v", trusted: false },
      taskId: "release-and-berth",
      inputs: [{ at: 0, action: { type: "key", keys: ["Enter"] } }],
      elapsedMs: 1000,
    });
    expect(answer).toHaveProperty("error");
    expect((answer as { error: string }).error).toMatch(/last hour/);
    expect(repo.createRun).not.toHaveBeenCalled();
  });
});
