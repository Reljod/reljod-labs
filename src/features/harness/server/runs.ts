import "server-only";
import { getRun as getWorkflowRun, resumeHook, start } from "workflow/api";
import type { Owner } from "@/features/access/domain/owner";
import { LIMITS } from "../domain/limits";
import { type ApprovalRisk, approvalRefusal } from "../domain/permissions";
import type { PipelineId } from "../domain/pipeline";
import { resolveRuleStates, ruleVersionsOf } from "../domain/pipelines/apply";
import { isoOf } from "../domain/pipelines/dates";
import { pipelineOf, subjectOf } from "../domain/pipelines/index";
import { parseRunInput, sourceIdsOf } from "../domain/pipelines/input";
import type { RuleState } from "../domain/rules";
import {
  ACTIVE_RUN_STATUSES,
  type ApprovalDecision,
  isRunActive,
  type RunEvent,
  type RunEventInput,
  type RunStatus,
  type RunSummary,
  type RunView,
  type StartedVia,
} from "../domain/run";
import type { Staff } from "../domain/staff";
import type { Actor, PaidActor } from "./actor";
import { audit, auditIn } from "./audit";
import { assertCan } from "./context";
import { isUuid, jsonb, sql } from "./db";
import {
  ForbiddenError,
  InvalidError,
  LimitError,
  NotBuiltError,
  NotFoundError,
  StateError,
} from "./errors";
import { sourcesOf } from "./pipelines/source-file";
import {
  expireRunApprovals,
  listRunSummaries,
  loadRunView,
  runRowOf,
  setRunStatus,
} from "./pipelines/store";
import type { ApprovalAnswer, RunContext } from "./pipelines/types";
import { takeRate } from "./rate";
import { currentRuleStates } from "./rules";
import { harnessRun } from "./run-workflow";
import { writableSession } from "./sessions";
import { modelStubbed } from "./stub";

/*
 * The Runs API. The routes under `/api/harness/runs` and `/api/harness/
 * approvals`, the Pipelines tab, the chat and the MCP server all call these
 * and nothing else to reach a Run.
 */

/** A Run still `queued` or `running` this long after its last change has lost its workflow. */
const STALE_RUNNING = "1 hour";
/** A Run waiting this long has outlived its Approval's wait (24 hours). */
const STALE_WAITING = "25 hours";

const SCHEDULE_FORMATS = /\.(csv|xlsx)$/i;

/**
 * The Rule states a Run applies: the Workspace's current states laid over
 * the Defaults. Until the Skills slice lands, `currentRuleStates` throws
 * NotBuiltError and every Rule is at its Default.
 */
async function ruleStatesFor(owner: Owner, pipelineId: PipelineId) {
  let saved: Record<string, RuleState> | null = null;
  try {
    saved = await currentRuleStates(owner);
  } catch (error) {
    if (!(error instanceof NotBuiltError)) throw error;
  }
  return resolveRuleStates(pipelineId, saved);
}

const tooMany = (active: number) =>
  new LimitError(
    `${active} Runs are already at work in this Workspace (at most ${LIMITS.maxConcurrentRuns}). Let one finish or stop it first.`,
  );

/** The Session a Run is started in: only the Staff member's own (a Run's card appears there). */
async function sessionOf(
  input: { owner: Owner; staff: Pick<Staff, "id"> },
  sessionId: string | null,
): Promise<string | null> {
  if (!sessionId) return null;
  return (await writableSession(input, sessionId)).id;
}

/**
 * Starts a Run of a Pipeline on the Workflow SDK and returns it as it stands
 * (queued, every Step pending): checks the Role, the input and that its
 * Sources are the Owner's, takes one of the visitor's Runs this hour, holds
 * the Workspace to `LIMITS.maxConcurrentRuns`, snapshots the Rule Versions
 * and writes `run.started`. `sessionId` is null when Claude starts it over MCP.
 */
export async function startRun(
  input: PaidActor & {
    sessionId: string | null;
    pipelineId: PipelineId;
    input: Record<string, unknown>;
    via: StartedVia;
  },
): Promise<RunView> {
  const { owner, staff, visitor } = input;
  assertCan(staff, "run.start");
  const spec = pipelineOf(input.pipelineId);
  if (!spec)
    throw new InvalidError(
      `There is no Pipeline called "${String(input.pipelineId)}".`,
    );
  const asOf = isoOf(new Date());
  const parsed = parseRunInput(spec.id, input.input, asOf);
  if (!parsed.ok) throw new InvalidError(parsed.message);

  const ids = sourceIdsOf(parsed.input);
  const sources = await sourcesOf(owner, ids);
  if (sources.length !== ids.length) {
    throw new NotFoundError(
      "A paper given to the Run is not in this Workspace.",
    );
  }
  if (spec.id === "contribution_processing") {
    const [schedule] = sources;
    const looksRight =
      schedule &&
      (["csv", "sheet"].includes(schedule.kind) ||
        SCHEDULE_FORMATS.test(schedule.storagePath ?? ""));
    if (!looksRight)
      throw new InvalidError("A Schedule must be a CSV or XLSX file.");
  }
  const sessionId = await sessionOf(input, input.sessionId);

  // Refuse a full Workspace before spending one of the visitor's Runs this
  // hour; the transaction below checks again under the lock.
  const db = sql();
  const [{ busy } = { busy: 0 }] = await db<{ busy: number }[]>`
    select count(*)::int as busy from harness.runs
    where owner = ${owner} and status in ${db(ACTIVE_RUN_STATUSES)}
      and updated_at > now() - ${STALE_RUNNING}::interval`;
  if (busy >= LIMITS.maxConcurrentRuns) throw tooMany(busy);
  await takeRate(visitor, owner, "run");
  const states = await ruleStatesFor(owner, spec.id);
  const ruleVersions = ruleVersionsOf(states);

  const runId = await db.begin(async (tx) => {
    // One Run starts at a time per Workspace, so two cannot both take the last place.
    await tx`select pg_advisory_xact_lock(hashtext(${`harness-runs:${owner}`}))`;
    // The escape hatch for a Run whose workflow died: it cannot hold a place forever.
    await tx`
      update harness.runs
      set status = 'failed', error = 'The Run lost its workflow.', finished_at = now(), updated_at = now()
      where owner = ${owner} and status in ('queued', 'running')
        and updated_at < now() - ${STALE_RUNNING}::interval`;
    await tx`
      update harness.runs
      set status = 'stopped', error = 'The Approval was not decided in time.', finished_at = now(), updated_at = now()
      where owner = ${owner} and status = 'waiting_approval'
        and updated_at < now() - ${STALE_WAITING}::interval`;
    const [{ active } = { active: 0 }] = await tx<{ active: number }[]>`
      select count(*)::int as active from harness.runs
      where owner = ${owner} and status in ${tx(ACTIVE_RUN_STATUSES)}`;
    if (active >= LIMITS.maxConcurrentRuns) throw tooMany(active);
    const [row] = await tx<{ id: string }[]>`
      insert into harness.runs (owner, session_id, pipeline_id, status, input, rule_versions, started_by, started_via)
      values (${owner}, ${sessionId}, ${spec.id}, 'queued', ${jsonb(tx, parsed.input)},
              ${jsonb(tx, ruleVersions)}, ${staff.id}, ${input.via})
      returning id`;
    if (!row) throw new Error("The Run was not saved");
    await tx`
      insert into harness.run_steps ${tx(
        spec.steps.map((step) => ({
          run_id: row.id,
          step_id: step.id,
          owner,
          status: "pending",
        })),
      )}`;
    return row.id;
  });

  const ctx: RunContext = {
    runId,
    owner,
    sessionId,
    pipelineId: spec.id,
    input: parsed.input,
    asOf,
    stubbed: await modelStubbed(visitor.trusted),
    states,
    startedBy: { id: staff.id, name: staff.name },
  };
  // Written before the workflow starts, so its Steps' events follow it in the trail.
  await audit({
    owner,
    actor: { kind: "staff", staff },
    action: "run.started",
    summary: `Started ${spec.title}: ${subjectOf(spec.id, parsed.input, null)}`,
    sessionId,
    runId,
    target: { kind: "run", id: runId },
    detail: {
      pipelineId: spec.id,
      via: input.via,
      input: parsed.input,
      ruleVersions,
      stubbed: ctx.stubbed,
    },
  });
  try {
    const workflow = await start(harnessRun, [ctx]);
    await db`
      update harness.runs set workflow_run_id = ${workflow.runId}
      where owner = ${owner} and id = ${runId}`;
  } catch (error) {
    await setRunStatus(owner, runId, "failed", {
      error: "The Run could not be started.",
    });
    await audit({
      owner,
      actor: { kind: "system" },
      action: "run.finished",
      summary: "Run failed: the workflow could not be started.",
      sessionId,
      runId,
      target: { kind: "run", id: runId },
      detail: { pipelineId: spec.id, status: "failed" },
    });
    throw error;
  }
  const run = await loadRunView(owner, runId);
  if (!run) throw new Error("The Run was not found after starting it");
  return run;
}

/** A Run with its Steps, Findings, Approvals and Drafts, or null when it is not in the Owner's Workspace. */
export async function getRun(
  owner: Owner,
  runId: string,
): Promise<RunView | null> {
  return loadRunView(owner, runId);
}

/** The Workspace's Runs, newest first; one Session's when `sessionId` is given. Runs are not private to a Staff member. */
export async function listRuns(
  owner: Owner,
  filter: { sessionId?: string | null; limit?: number } = {},
): Promise<RunSummary[]> {
  return listRunSummaries(owner, filter);
}

/** Writes the last events to a Run's stream and closes it. Best effort: the stream may already be closed. */
async function closeWorkflowStream(
  workflowRunId: string,
  event: RunEventInput,
) {
  try {
    const writer = getWorkflowRun(workflowRunId)
      .getWritable<RunEvent>()
      .getWriter();
    await writer.write({
      ...event,
      seq: -1,
      at: new Date().toISOString(),
    } as RunEvent);
    await writer.close();
  } catch {
    // The events route ends the stream of a Run that is over by itself.
  }
}

/**
 * Stops a Run. The escape hatch: cancelling the workflow is best effort
 * (try/catch), and the Run is always marked `stopped` locally, so a Run
 * whose workflow already died can still be cleared (conventions.md). Checks
 * `can(staff, "run.stop")` and writes `run.stopped`. Stopping a Run that has
 * ended returns it unchanged.
 */
export async function stopRun(
  input: Actor & { runId: string },
): Promise<RunView> {
  const { owner, staff } = input;
  assertCan(staff, "run.stop");
  const db = sql();
  const row = await runRowOf(db, owner, input.runId);
  if (!row) throw new NotFoundError("That Run is not in this Workspace.");
  if (!isRunActive(row.status)) {
    const run = await loadRunView(owner, row.id);
    if (!run) throw new NotFoundError("That Run is not in this Workspace.");
    return run;
  }
  if (row.workflow_run_id) {
    try {
      await getWorkflowRun(row.workflow_run_id).cancel({
        cancelReason: `Stopped by ${staff.name}`,
      });
    } catch {
      // The workflow already ended or died without updating the row: stop the row anyway.
    }
  }
  await db.begin(async (tx) => {
    await tx`
      update harness.runs
      set status = 'stopped', finished_at = now(), updated_at = now(),
          error = coalesce(error, ${`Stopped by ${staff.name}.`})
      where owner = ${owner} and id = ${row.id} and status in ${tx(ACTIVE_RUN_STATUSES)}`;
    await tx`
      update harness.run_steps set status = 'skipped', finished_at = now()
      where owner = ${owner} and run_id = ${row.id} and status = 'running'`;
    await expireRunApprovals(tx, owner, row.id);
  });
  if (row.workflow_run_id) {
    await closeWorkflowStream(row.workflow_run_id, {
      type: "run.finished",
      status: "stopped",
      result: null,
      error: `Stopped by ${staff.name}.`,
    });
  }
  await audit({
    owner,
    actor: { kind: "staff", staff },
    action: "run.stopped",
    summary: `Stopped the Run: ${subjectOf(row.pipeline_id, row.input ?? {}, row.result)}`,
    sessionId: row.session_id,
    runId: row.id,
    target: { kind: "run", id: row.id },
    detail: { pipelineId: row.pipeline_id, was: row.status },
  });
  const run = await loadRunView(owner, row.id);
  if (!run) throw new NotFoundError("That Run is not in this Workspace.");
  return run;
}

type ClaimRow = {
  id: string;
  run_id: string;
  risk: ApprovalRisk;
  status: string;
  hook_token: string | null;
  title: string;
  kind: string;
  started_by: string;
  session_id: string | null;
  run_status: RunStatus;
  workflow_run_id: string | null;
};

/**
 * A person approves or returns an Approval's Draft, which resumes the Run.
 * Held to the Owner; refused with a ForbiddenError when `approvalRefusal`
 * says so (high risk needs an admin who did not start the Run); refused with
 * a StateError unless it is still `pending`, claimed in the update so a
 * double click decides once; `approval.decided` is written in the same
 * transaction. There is no MCP tool for this: the Agent approves nothing.
 */
export async function decideApproval(
  input: Actor & {
    approvalId: string;
    decision: ApprovalDecision;
    note?: string | null;
  },
): Promise<RunView> {
  const { owner, staff } = input;
  if (!isUuid(input.approvalId))
    throw new NotFoundError("That Approval is not in this Workspace.");
  if (input.decision !== "approve" && input.decision !== "return") {
    throw new InvalidError("Approve or return the Draft.");
  }
  const note = input.note?.trim().slice(0, 1000) || null;
  const db = sql();
  const claimed = await db.begin(async (tx) => {
    const [row] = await tx<ClaimRow[]>`
      select a.id, a.run_id, a.risk, a.status, a.hook_token, a.title, a.kind,
             r.started_by, r.session_id, r.status as run_status, r.workflow_run_id
      from harness.approvals a
      join harness.runs r on r.id = a.run_id and r.owner = a.owner
      where a.owner = ${owner} and a.id = ${input.approvalId}
      for update of a`;
    if (!row)
      throw new NotFoundError("That Approval is not in this Workspace.");
    const refusal = approvalRefusal(staff, {
      risk: row.risk,
      startedBy: row.started_by,
    });
    if (refusal)
      throw new ForbiddenError(
        refusal,
        row.risk === "high" ? "approval.decide.high" : "approval.decide.low",
      );
    if (row.status !== "pending") {
      throw new StateError(
        row.status === "expired"
          ? "This Approval has expired: its Run was stopped or waited too long."
          : `This Approval was already ${row.status}.`,
      );
    }
    if (!isRunActive(row.run_status) || !row.hook_token) {
      throw new StateError(
        "This Run has ended; its Approval can no longer be decided.",
      );
    }
    const status = input.decision === "approve" ? "approved" : "returned";
    const updated = await tx`
      update harness.approvals
      set status = ${status}, decided_by = ${staff.id}, decided_at = now(), note = ${note}
      where owner = ${owner} and id = ${row.id} and status = 'pending'
      returning id`;
    if (updated.length === 0)
      throw new StateError("This Approval was decided a moment ago.");
    await auditIn(tx, {
      owner,
      actor: { kind: "staff", staff },
      action: "approval.decided",
      summary: `${input.decision === "approve" ? "Approved" : "Returned"} ${row.risk}-risk ${row.title}`,
      sessionId: row.session_id,
      runId: row.run_id,
      target: { kind: "approval", id: row.id },
      detail: {
        decision: input.decision,
        risk: row.risk,
        kind: row.kind,
        note,
      },
    });
    return row;
  });

  const answer: ApprovalAnswer = {
    approvalId: claimed.id,
    decision: input.decision,
    note,
    decidedBy: { id: staff.id, name: staff.name },
  };
  try {
    await resumeHook(claimed.hook_token as string, answer);
  } catch (error) {
    // The decision stands; the Run whose workflow is gone is closed so it does not hold a place.
    console.error(
      "[harness] could not resume the Run",
      error instanceof Error ? error.message : error,
    );
    const moved = await setRunStatus(owner, claimed.run_id, "failed", {
      error: "The Run could not be resumed after the decision.",
    });
    if (moved && claimed.workflow_run_id) {
      await closeWorkflowStream(claimed.workflow_run_id, {
        type: "run.finished",
        status: "failed",
        result: null,
        error: "The Run could not be resumed after the decision.",
      });
    }
  }
  const run = await loadRunView(owner, claimed.run_id);
  if (!run) throw new NotFoundError("That Run is not in this Workspace.");
  return run;
}

/** How long a Run that is over may go quiet before its replay ends. */
const IDLE_MS = 2500;

function arrayStream(events: RunEvent[]): ReadableStream<RunEvent> {
  return new ReadableStream<RunEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
}

/**
 * The Run's live stream from event number `from` (0 for all of it), or null
 * when the Run is not in the Owner's Workspace. Events are numbered here, by
 * their place in the workflow's stream, so `from` resumes exactly. The first
 * event is always `run.started`; the stream closes after `run.finished`. A
 * Run that is over but whose stream nobody closed (its workflow died) ends
 * with a `run.finished` made from its row.
 */
export async function runEventsStream(
  owner: Owner,
  runId: string,
  from = 0,
): Promise<ReadableStream<RunEvent> | null> {
  const row = await runRowOf(sql(), owner, runId);
  if (!row) return null;
  const start = Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0;
  const over = !isRunActive(row.status);
  const final = (seq: number): RunEvent => ({
    seq,
    at: new Date().toISOString(),
    type: "run.finished",
    status:
      row.status === "completed" ||
      row.status === "returned" ||
      row.status === "stopped"
        ? row.status
        : "failed",
    result: row.result,
    error: row.error,
  });

  if (!row.workflow_run_id) {
    // Never reached the workflow (it failed to start): the row is all there is.
    const run = await loadRunView(owner, row.id);
    if (!run) return null;
    const events: RunEvent[] = [
      { seq: 0, at: run.createdAt, type: "run.started", run },
    ];
    if (over) events.push(final(1));
    return arrayStream(events.slice(start));
  }

  const reader = getWorkflowRun(row.workflow_run_id)
    .getReadable<RunEvent>({ startIndex: start })
    .getReader();
  let seq = start;
  let ended = false;
  return new ReadableStream<RunEvent>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<"idle">((resolve) => {
        if (over) timer = setTimeout(() => resolve("idle"), IDLE_MS);
      });
      const next = await Promise.race([reader.read(), idle]);
      clearTimeout(timer);
      if (next === "idle" || next.done) {
        if (over && !ended) controller.enqueue(final(seq));
        controller.close();
        void reader.cancel().catch(() => {});
        return;
      }
      const event = { ...next.value, seq: seq++ } as RunEvent;
      controller.enqueue(event);
      if (event.type === "run.finished") {
        ended = true;
        controller.close();
        void reader.cancel().catch(() => {});
      }
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });
}
