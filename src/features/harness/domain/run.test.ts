import { describe, expect, it } from "vitest";
import {
  type ApprovalView,
  type Finding,
  type RunEvent,
  type RunEventInput,
  type RunView,
  reduceRun,
  replayRun,
} from "./run";

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

const run: RunView = {
  id: "run-1",
  pipelineId: "member_request",
  sessionId: "session-1",
  status: "queued",
  subject: "Transfer out · M-10482",
  startedBy: { id: "staff-1", name: "Keisha Wraymond" },
  startedVia: "chat",
  createdAt: at(0),
  updatedAt: at(0),
  finishedAt: null,
  input: { memberRequestId: "req-1" },
  result: null,
  error: null,
  ruleVersions: { "mr.notice": 2 },
  steps: [pending("load"), pending("eligibility"), pending("approve")],
  findings: [],
  approvals: [],
  drafts: [],
};

const finding: Finding = {
  id: "finding-1",
  ruleId: "mr.notice",
  ruleVersion: 2,
  stepId: "eligibility",
  met: false,
  outcome: "refer",
  summary: "18 months away; the Rule needs 24.",
  compared: { monthsAway: 18, needed: 24 },
  createdAt: at(3),
};

const approval: ApprovalView = {
  id: "approval-1",
  stepId: "approve",
  kind: "letter",
  risk: "low",
  title: "Letter to the Member",
  draft: {
    kind: "letter",
    title: "Letter to the Member",
    to: "A. Member",
    body: "Dear Member",
    stepId: "draft",
  },
  status: "pending",
  requestedAt: at(5),
  decidedBy: null,
  decidedAt: null,
  note: null,
};

let seq = 0;
const event = (second: number, body: RunEventInput) =>
  ({ ...body, seq: seq++, at: at(second) }) as RunEvent;

const events: RunEvent[] = [
  event(0, { type: "run.started", run }),
  event(1, { type: "step.started", stepId: "load" }),
  event(2, {
    type: "step.finished",
    stepId: "load",
    status: "done",
    output: { member: "M-10482" },
    usage: null,
  }),
  event(2, { type: "step.started", stepId: "eligibility" }),
  event(3, { type: "finding", finding }),
  event(4, {
    type: "step.finished",
    stepId: "eligibility",
    status: "done",
    output: null,
    usage: null,
  }),
  event(5, { type: "draft", draft: approval.draft }),
  event(5, { type: "step.started", stepId: "approve" }),
  event(5, { type: "approval.requested", approval }),
];

describe("reduceRun", () => {
  it("starts from the Run that run.started carries", () => {
    expect(reduceRun(null, events[0] as RunEvent)).toEqual(run);
  });

  it("drops events that arrive before run.started", () => {
    expect(reduceRun(null, events[1] as RunEvent)).toBeNull();
  });

  it("moves Steps through running to done and keeps their output", () => {
    const state = replayRun(events.slice(0, 3));
    expect(state?.status).toBe("running");
    expect(state?.steps[0]).toMatchObject({
      status: "done",
      startedAt: at(1),
      finishedAt: at(2),
      output: { member: "M-10482" },
    });
    expect(state?.steps[1]?.status).toBe("pending");
    expect(state?.updatedAt).toBe(at(2));
  });

  it("collects Findings and Drafts and waits at an Approval", () => {
    const state = replayRun(events);
    expect(state?.findings).toEqual([finding]);
    expect(state?.drafts).toEqual([approval.draft]);
    expect(state?.approvals).toEqual([approval]);
    expect(state?.status).toBe("waiting_approval");
  });

  it("goes on after an Approval is given and ends completed", () => {
    const state = replayRun([
      ...events,
      event(9, {
        type: "approval.decided",
        approvalId: "approval-1",
        status: "approved",
        decidedBy: { id: "staff-2", name: "Dario Pennycooke" },
        note: null,
      }),
      event(9, {
        type: "step.finished",
        stepId: "approve",
        status: "done",
        output: null,
        usage: null,
      }),
      event(10, {
        type: "run.finished",
        status: "completed",
        result: { letter: "sent" },
        error: null,
      }),
    ]);
    expect(state?.approvals[0]).toMatchObject({
      status: "approved",
      decidedBy: { id: "staff-2", name: "Dario Pennycooke" },
      decidedAt: at(9),
    });
    expect(state?.status).toBe("completed");
    expect(state?.finishedAt).toBe(at(10));
    expect(state?.result).toEqual({ letter: "sent" });
    expect(state?.steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
    ]);
  });

  it("records a failed Step and marks Steps cut short by a stop as skipped", () => {
    const failed = replayRun([
      ...events.slice(0, 4),
      event(3, { type: "step.failed", stepId: "eligibility", error: "boom" }),
      event(3, {
        type: "run.finished",
        status: "failed",
        result: null,
        error: "boom",
      }),
    ]);
    expect(failed?.steps[1]).toMatchObject({ status: "failed", error: "boom" });
    expect(failed?.status).toBe("failed");

    const stopped = replayRun([
      ...events.slice(0, 4),
      event(3, {
        type: "run.finished",
        status: "stopped",
        result: null,
        error: null,
      }),
    ]);
    expect(stopped?.steps[1]?.status).toBe("skipped");
    expect(stopped?.steps[2]?.status).toBe("pending");
  });

  it("changes nothing when an event is seen twice", () => {
    const once = replayRun(events);
    const twice = replayRun([...events, ...events.slice(1)]);
    expect(twice).toEqual(once);
  });

  it("does not wake a Run that has ended", () => {
    const ended = replayRun([
      ...events,
      event(6, {
        type: "run.finished",
        status: "stopped",
        result: null,
        error: null,
      }),
      event(7, { type: "step.started", stepId: "approve" }),
      event(7, { type: "approval.requested", approval }),
    ]);
    expect(ended?.status).toBe("stopped");
  });

  it("adds a Step the first event did not list", () => {
    const state = replayRun([
      events[0] as RunEvent,
      event(1, { type: "step.started", stepId: "extra" }),
    ]);
    expect(state?.steps.at(-1)).toMatchObject({
      stepId: "extra",
      status: "running",
    });
  });

  it("does not change the state it is given", () => {
    const before = structuredClone(run);
    reduceRun(run, events[1] as RunEvent);
    expect(run).toEqual(before);
  });
});

describe("a finished Run's subject", () => {
  it("names the Member the Run read, and keeps the old subject otherwise", () => {
    const started = {
      ...run,
      subject: "Member request · 1 paper",
      input: { sourceIds: ["a"] },
    };
    const finish = (result: Record<string, unknown>) =>
      replayRun([
        event(1, { type: "run.started", run: started }),
        event(2, {
          type: "run.finished",
          status: "completed",
          result,
          error: null,
        }),
      ]);
    expect(
      finish({ kind: "cessation_of_residence", memberNo: "HB-10042" })?.subject,
    ).toBe("Withdrawal on leaving Cayman · HB-10042");
    expect(finish({ letter: "sent" })?.subject).toBe(
      "Member request · 1 paper",
    );
  });
});
