import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConflictError,
  ForbiddenError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { LIMITS } from "../../domain/limits";
import type { RunView } from "../../domain/run";
import type { Staff } from "../../domain/staff";
import type { ApprovalClaim, RunRepository } from "../ports";
import { createRunService } from "./runs";

const owner = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const visitor = { hash: "v", trusted: false };
const staff = (id: string, role: Staff["role"]): Staff => ({
  id,
  key: id,
  name: id,
  title: "",
  role,
  initials: "",
});
const keisha = staff("11111111-1111-4111-8111-111111111111", "user");
const marva = staff("22222222-2222-4222-8222-222222222222", "admin");
const otherAdmin = staff("33333333-3333-4333-8333-333333333333", "admin");
const paper = "44444444-4444-4444-8444-444444444444";
const runId = "55555555-5555-4555-8555-555555555555";

function setup(
  overrides: {
    runs?: Partial<RunRepository>;
    papers?: number;
    take?: () => Promise<void>;
  } = {},
) {
  const calls: string[] = [];
  const view = { id: runId, approvals: [] } as unknown as RunView;
  const runs: RunRepository = {
    busy: async () => 0,
    insert: async () => {
      calls.push("insert");
      return { runId };
    },
    setWorkflow: async () => {},
    setStatus: async () => true,
    row: async () => null,
    view: async () => view,
    list: async () => [],
    markStopped: async () => {},
    decide: async () => {
      throw new Error("unused");
    },
    ...overrides.runs,
  };
  const service = createRunService({
    runs,
    sources: {
      meta: async (_owner, ids) =>
        ids.slice(0, overrides.papers ?? ids.length).map((id) => ({
          id,
          title: "Paper",
          kind: "text",
          storagePath: null,
          status: "pending",
          addedOn: "2026-11-27",
        })),
    },
    rules: { statesAsOf: async () => ({}) },
    sessions: {
      writable: async () => {
        throw new Error("unused");
      },
    },
    workflows: {
      start: async () => {
        calls.push("workflow");
        return "wf";
      },
      cancel: async () => {},
      resume: async (token) => {
        calls.push(`resume:${token}`);
      },
      reader: () => {
        throw new Error("unused");
      },
      close: async () => {},
    },
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
        await overrides.take?.();
      },
      used: async () => ({}) as never,
    },
    audit: { record: async () => 1, strict: async () => {} },
    today: () => "2026-11-27",
    stubSteps: false,
  });
  return { service, calls };
}

const request = {
  pipelineId: "member_request" as const,
  input: { sourceIds: [paper] },
  sessionId: null,
  via: "app" as const,
};

describe("a Run spends nothing it should not", () => {
  it("refuses a paper that is not the Owner's before taking a Run this hour", async () => {
    const { service, calls } = setup({ papers: 0 });
    await expect(
      service.start({ owner, staff: keisha, visitor }, request),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });

  it("refuses a full Workspace before taking a Run this hour", async () => {
    const { service, calls } = setup({
      runs: { busy: async () => LIMITS.maxConcurrentRuns },
    });
    await expect(
      service.start({ owner, staff: keisha, visitor }, request),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });

  it("takes the rate before the Run is saved, and a refusal saves and starts nothing", async () => {
    const { service, calls } = setup({
      take: async () => {
        throw new LimitError("That's 10 Runs this hour.");
      },
    });
    await expect(
      service.start({ owner, staff: keisha, visitor }, request),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual(["take:run"]);
  });

  it("saves the Run (with its event) before its workflow starts", async () => {
    const { service, calls } = setup();
    await service.start({ owner, staff: keisha, visitor }, request);
    expect(calls).toEqual(["take:run", "insert", "workflow"]);
  });
});

describe("four eyes on a high-risk Approval", () => {
  const claim: ApprovalClaim = {
    id: "66666666-6666-4666-8666-666666666666",
    runId,
    risk: "high",
    status: "pending",
    hookToken: "hook",
    title: "Payment instruction",
    kind: "payment_instruction",
    startedBy: marva.id,
    sessionId: null,
    runStatus: "waiting_approval",
    workflowRunId: "wf",
  };

  /** A repository that hands the service the claim under its lock and applies whatever it decides. */
  const deciding = (found: ApprovalClaim | null) => ({
    decide: (async (_owner, _id, decide) => {
      decide(found);
      return { claim: found as ApprovalClaim, applied: true };
    }) satisfies RunRepository["decide"],
  });

  it("refuses the admin who started the Run, and nothing resumes", async () => {
    const { service, calls } = setup({ runs: deciding(claim) });
    await expect(
      service.decide({ owner, staff: marva }, claim.id, "approve"),
    ).rejects.toThrow(
      new ForbiddenError(
        "A high-risk Approval needs an admin who did not start the Run.",
      ),
    );
    expect(calls).toEqual([]);
  });

  it("refuses a user", async () => {
    const { service } = setup({ runs: deciding(claim) });
    await expect(
      service.decide({ owner, staff: keisha }, claim.id, "approve"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets another admin approve, and resumes the Run", async () => {
    const { service, calls } = setup({ runs: deciding(claim) });
    await service.decide({ owner, staff: otherAdmin }, claim.id, "approve");
    expect(calls).toEqual(["resume:hook"]);
  });

  it("refuses an Approval of a Run that has ended", async () => {
    const { service } = setup({
      runs: deciding({ ...claim, runStatus: "stopped" }),
    });
    await expect(
      service.decide({ owner, staff: otherAdmin }, claim.id, "approve"),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("answers an Approval of another Workspace as not found", async () => {
    const { service } = setup({ runs: deciding(null) });
    await expect(
      service.decide({ owner, staff: otherAdmin }, claim.id, "approve"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
