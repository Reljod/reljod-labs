import type { AuditUsage } from "./audit";
import type { ApprovalRisk } from "./permissions";
import type { PipelineId } from "./pipeline";
import type { Outcome } from "./rules";

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "returned",
  "failed",
  "stopped",
] as const;

/** A Run ends `completed`, `returned` (a person sent it back), `failed` or `stopped`. */
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ACTIVE_RUN_STATUSES: RunStatus[] = [
  "queued",
  "running",
  "waiting_approval",
];

export function isRunActive(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** Where a Run was started from. */
export type StartedVia = "chat" | "mcp" | "app" | "demo";

export type StepView = {
  stepId: string;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** What the Step worked out, shown with its inputs. */
  output: unknown;
  error: string | null;
  /** Set only for Steps that call a model. */
  usage: AuditUsage | null;
};

/** What one Rule concluded in one Run. */
export type Finding = {
  id: string;
  ruleId: string;
  /** The Rule Version the Run applied; 0 is the Default. */
  ruleVersion: number;
  stepId: string;
  met: boolean;
  /** The Rule's Outcome at that Version; it bites only when `met` is false. */
  outcome: Outcome;
  summary: string;
  /** The values the check compared. */
  compared: Record<string, unknown>;
  createdAt: string;
};

/** The text a Run prepares for a person to approve. */
export type Draft = {
  /** `letter`, `payment_instruction`, `employer_query`, `regulator_report`, … */
  kind: string;
  title: string;
  /** Who it is addressed to, if anyone. */
  to: string | null;
  /** Markdown. */
  body: string;
  /** The Step that wrote it. */
  stepId: string;
};

export type ApprovalStatus = "pending" | "approved" | "returned" | "expired";

/** The point where a Run waits for a person. */
export type ApprovalView = {
  id: string;
  /** The Approval Step that asked. */
  stepId: string;
  kind: string;
  risk: ApprovalRisk;
  title: string;
  draft: Draft;
  status: ApprovalStatus;
  requestedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  note: string | null;
};

/** A Run in a list. */
export type RunSummary = {
  id: string;
  pipelineId: PipelineId;
  sessionId: string | null;
  status: RunStatus;
  /** One line on what the Run is about: "Transfer out · M-10482". */
  subject: string;
  startedBy: { id: string; name: string };
  startedVia: StartedVia;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

/** A Run with everything the Pipeline view draws. */
export type RunView = RunSummary & {
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  /** rule id → the Version this Run applied. */
  ruleVersions: Record<string, number>;
  steps: StepView[];
  findings: Finding[];
  approvals: ApprovalView[];
  drafts: Draft[];
};

export type ApprovalDecision = "approve" | "return";

/**
 * What a Run streams to whoever is watching, one JSON object per line. `seq`
 * counts up from 0 within a Run, so a watcher that reconnects asks for the
 * events after the last one it saw.
 */
export type RunEvent = {
  seq: number;
  at: string;
} /** Always first: the Run as it stands, with every Step `pending`. */ & (
  | { type: "run.started"; run: RunView }
  | { type: "step.started"; stepId: string }
  | {
      type: "step.finished";
      stepId: string;
      /** `skipped` when an earlier Finding made the Step unnecessary. */
      status: "done" | "skipped";
      output: unknown;
      usage: AuditUsage | null;
    }
  | { type: "step.failed"; stepId: string; error: string }
  | { type: "finding"; finding: Finding }
  | { type: "draft"; draft: Draft }
  | { type: "approval.requested"; approval: ApprovalView }
  | {
      type: "approval.decided";
      approvalId: string;
      status: "approved" | "returned" | "expired";
      decidedBy: { id: string; name: string } | null;
      note: string | null;
    }
  | {
      type: "run.finished";
      status: "completed" | "returned" | "failed" | "stopped";
      result: Record<string, unknown> | null;
      error: string | null;
    }
);

export type RunEventType = RunEvent["type"];

/** A RunEvent before the emitter numbers and dates it. */
export type RunEventInput = RunEvent extends infer Event
  ? Event extends RunEvent
    ? Omit<Event, "seq" | "at">
    : never
  : never;

function patchStep(
  run: RunView,
  stepId: string,
  patch: Partial<StepView>,
): StepView[] {
  const known = run.steps.some((step) => step.stepId === stepId);
  const steps = known
    ? run.steps
    : [
        ...run.steps,
        {
          stepId,
          status: "pending" as const,
          startedAt: null,
          finishedAt: null,
          output: null,
          error: null,
          usage: null,
        },
      ];
  return steps.map((step) =>
    step.stepId === stepId ? { ...step, ...patch } : step,
  );
}

const upsert = <T>(items: T[], item: T, same: (a: T) => boolean) =>
  items.some(same)
    ? items.map((existing) => (same(existing) ? item : existing))
    : [...items, item];

/**
 * Applies one RunEvent to what the Pipeline view holds. Pure: the same events
 * in the same order give the same RunView, and replaying a tail that overlaps
 * what was already applied (a reconnect) ends in the same state. Events
 * before `run.started` are dropped, and nothing but `run.started` changes the
 * status of a Run that has already ended.
 */
export function reduceRun(
  state: RunView | null,
  event: RunEvent,
): RunView | null {
  if (event.type === "run.started") return event.run;
  if (!state) return null;
  const ended = !isRunActive(state.status);
  const touched = { ...state, updatedAt: event.at };
  switch (event.type) {
    case "step.started":
      return {
        ...touched,
        status: ended ? state.status : "running",
        steps: patchStep(state, event.stepId, {
          status: "running",
          startedAt: event.at,
          finishedAt: null,
          error: null,
        }),
      };
    case "step.finished":
      return {
        ...touched,
        steps: patchStep(state, event.stepId, {
          status: event.status,
          finishedAt: event.at,
          output: event.output,
          usage: event.usage,
          error: null,
        }),
      };
    case "step.failed":
      return {
        ...touched,
        steps: patchStep(state, event.stepId, {
          status: "failed",
          finishedAt: event.at,
          error: event.error,
        }),
      };
    case "finding":
      return {
        ...touched,
        findings: upsert(
          state.findings,
          event.finding,
          (finding) => finding.id === event.finding.id,
        ),
      };
    case "draft":
      return {
        ...touched,
        drafts: upsert(
          state.drafts,
          event.draft,
          (draft) =>
            draft.stepId === event.draft.stepId &&
            draft.kind === event.draft.kind,
        ),
      };
    case "approval.requested":
      return {
        ...touched,
        status: ended ? state.status : "waiting_approval",
        approvals: upsert(
          state.approvals,
          event.approval,
          (approval) => approval.id === event.approval.id,
        ),
      };
    case "approval.decided": {
      const approvals = state.approvals.map((approval) =>
        approval.id === event.approvalId
          ? {
              ...approval,
              status: event.status,
              decidedBy: event.decidedBy,
              decidedAt: event.at,
              note: event.note,
            }
          : approval,
      );
      const waiting = approvals.some(
        (approval) => approval.status === "pending",
      );
      return {
        ...touched,
        approvals,
        status: ended ? state.status : waiting ? "waiting_approval" : "running",
      };
    }
    case "run.finished":
      return {
        ...touched,
        status: event.status,
        result: event.result,
        error: event.error,
        finishedAt: event.at,
        // A Step still at work when the Run ended did not finish.
        steps: state.steps.map((step) =>
          step.status === "running" && event.status !== "completed"
            ? { ...step, status: "skipped" as const, finishedAt: event.at }
            : step,
        ),
      };
  }
}

/** The RunView after a list of events, for tests and for replaying a stored stream. */
export function replayRun(events: RunEvent[]): RunView | null {
  return events.reduce<RunView | null>(reduceRun, null);
}
