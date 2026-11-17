import { beforeEach, describe, expect, it, vi } from "vitest";

/* A Run's step functions with the database, the stream and the Pipelines faked. */

const state = vi.hoisted(() => ({
  runStatus: "running" as string,
  setStatusMoves: true,
  executed: 0,
  saved: 0,
  fanCalls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("workflow", () => {
  class FatalError extends Error {}
  return { FatalError, createHook: () => ({}), sleep: async () => {} };
});
vi.mock("./db", () => ({ sql: () => ({}) }));
vi.mock("./audit", () => ({ audit: async () => 1, auditMany: async () => [] }));
vi.mock("./llm", () => ({ addUsage: () => null }));
vi.mock("./pipelines/emit", () => ({
  emit: async () => {},
  closeStream: async () => {},
}));
vi.mock("./pipelines/store", () => ({
  approvalByToken: async () => null,
  expireApproval: async () => false,
  loadRunView: async () => ({ id: "run-1" }),
  markStepFinished: async () => {},
  markStepRunning: async () => {},
  openApproval: async () => ({ id: "a-1" }),
  runRowOf: async () => ({ status: state.runStatus }),
  saveFindings: async () => {
    state.saved += 1;
    return [];
  },
  setRunStatus: async () => state.setStatusMoves,
}));
vi.mock("./pipelines/runners", () => ({
  RUNNERS: {
    delinquency_report: {
      steps: {
        compute: async () => {
          state.executed += 1;
          return { output: { ok: true }, summary: "done" };
        },
      },
      fanOut: {
        draft_chasers: {
          items: () => [1],
          one: async () => {
            state.fanCalls += 1;
            return { value: 1, usage: null, fallback: false };
          },
          combine: () => ({ output: {}, summary: "" }),
        },
      },
    },
  },
}));

import { FatalError } from "workflow";
import {
  approvalSummary,
  beginStep,
  fanItemStep,
  recordStep,
  workStep,
} from "./run-workflow";

const ctx = {
  runId: "run-1",
  owner: "e2e",
  sessionId: null,
  pipelineId: "delinquency_report",
  input: {},
  asOf: "2026-11-17",
  stubbed: true,
  states: {},
  startedBy: { id: "s", name: "S" },
} as never;

beforeEach(() => {
  state.runStatus = "running";
  state.setStatusMoves = true;
  state.executed = 0;
  state.saved = 0;
  state.fanCalls = 0;
});

describe("a Run marked over spends nothing more", () => {
  it("ends the workflow at its first Step when the Run was already stopped", async () => {
    state.setStatusMoves = false;
    await expect(beginStep(ctx)).rejects.toBeInstanceOf(FatalError);
  });

  it("does not start a Step's work once the Run is stopped", async () => {
    state.runStatus = "stopped";
    await expect(workStep(ctx, "compute", {})).rejects.toBeInstanceOf(
      FatalError,
    );
    expect(state.executed).toBe(0);
  });

  it("does not make a fanned-out paid call once the Run is stopped", async () => {
    state.runStatus = "stopped";
    await expect(
      fanItemStep(ctx, "draft_chasers", 1, {}),
    ).rejects.toBeInstanceOf(FatalError);
    expect(state.fanCalls).toBe(0);
  });
});

describe("saving a Step is apart from its work", () => {
  it("does the work without saving, so a failed save retries only the save", async () => {
    const result = await workStep(ctx, "compute", {});
    expect(state.executed).toBe(1);
    expect(state.saved).toBe(0);
    await recordStep(ctx, "compute", result);
    expect(state.saved).toBe(1);
    expect(state.executed).toBe(1);
  });

  it("retries the work at most once, the save more", () => {
    expect((workStep as unknown as { maxRetries: number }).maxRetries).toBe(1);
    expect(
      (recordStep as unknown as { maxRetries: number }).maxRetries,
    ).toBeGreaterThan(1);
  });
});

describe("an approval given after the Run ended", () => {
  const person = { id: "s2", name: "Dario" };

  it("keeps the person's decision and says nothing was posted", () => {
    const summary = approvalSummary({
      approvalId: "a-1",
      decision: "approve",
      note: null,
      decidedBy: person,
      blocked: "run_ended",
    });
    expect(summary).toBe(
      "Dario approved the Draft after the Run ended; nothing was posted.",
    );
    expect(summary).not.toMatch(/in time/);
  });

  it("still says so when no one decided in time, and names an approval on a live Run plainly", () => {
    expect(
      approvalSummary({
        approvalId: "a-1",
        decision: "expired",
        note: null,
        decidedBy: null,
      }),
    ).toBe("No one decided the Approval in time.");
    expect(
      approvalSummary({
        approvalId: "a-1",
        decision: "approve",
        note: null,
        decidedBy: person,
      }),
    ).toBe("Dario approved the Draft.");
  });

  it("runs no Step after it: the next Step finds the Run ended", async () => {
    state.runStatus = "stopped";
    await expect(
      workStep(
        { ...(ctx as object), pipelineId: "delinquency_report" } as never,
        "compute",
        {},
      ),
    ).rejects.toBeInstanceOf(FatalError);
    expect(state.executed).toBe(0);
  });
});
