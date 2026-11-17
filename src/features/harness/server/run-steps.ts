import { FatalError } from "workflow";
import type { AuditUsage } from "../domain/audit";
import type { StepSpec } from "../domain/pipeline";
import { pipelineOf } from "../domain/pipelines/index";
import { type Draft, isRunActive, type RunEventInput } from "../domain/run";
import { audit, auditMany } from "./audit";
import { sql } from "./db";
import { addUsage } from "./llm";
import { closeStream, emit } from "./pipelines/emit";
import { RUNNERS } from "./pipelines/runners";
import {
  approvalByToken,
  expireApproval,
  loadRunView,
  markStepFinished,
  markStepRunning,
  openApproval,
  runRowOf,
  saveFindings,
  setRunStatus,
} from "./pipelines/store";
import {
  type ApprovalAnswer,
  type ApprovalOutcome,
  type Deps,
  type FanOut,
  type RunContext,
  StepProblem,
  type StepResult,
} from "./pipelines/types";

/*
 * The workflow steps of a Run (`run-workflow.ts` puts them in order).
 *
 * The Workflow SDK names a step after its function, and that name is all the
 * Vercel Workflow trace shows. So every Pipeline Step has its own step
 * functions, named after the Step: `classify` does the work and
 * `saveClassify` saves it, `readDocument` reads one paper. Each is a thin
 * shell over the shared body (`work`, `save`, `fanList`, `fanOne`, `fanSave`)
 * that does the actual work by Step id.
 *
 * A new Step in a Pipeline needs its pair here, in `STEP_FUNCTIONS` (or
 * `FAN_FUNCTIONS` when it does one piece of work per item); a test checks
 * every Pipeline against these tables.
 */

const actorFor = (kind: StepSpec["kind"]) =>
  kind === "model"
    ? ({ kind: "agent" } as const)
    : ({ kind: "system" } as const);

const stepKind = (ctx: RunContext, stepId: string): StepSpec["kind"] =>
  pipelineOf(ctx.pipelineId)?.steps.find((step) => step.id === stepId)?.kind ??
  "code";

/** What a Staff member may read about a failure: a StepProblem as written, anything else plainly. */
function problemText(stepId: string, error: unknown): string {
  if (error instanceof StepProblem) return error.message;
  console.error(`[harness] step ${stepId} failed`, error);
  return `The ${stepId.replace(/_/g, " ")} Step failed on our side.`;
}

/** Records a Step that has started: its row and the event. */
async function started(ctx: RunContext, stepId: string) {
  await markStepRunning(ctx.owner, ctx.runId, stepId);
  await emit({ type: "step.started", stepId });
}

/** Records a Step that finished: Findings, its row, the events and the Audit trail. */
async function finished(ctx: RunContext, stepId: string, result: StepResult) {
  const kind = stepKind(ctx, stepId);
  const findings = await saveFindings(
    ctx.owner,
    ctx.runId,
    result.findings ?? [],
  );
  const status = result.skipped ? "skipped" : "done";
  await markStepFinished(ctx.owner, ctx.runId, stepId, {
    status,
    output: result.output,
    usage: result.usage ?? null,
  });
  const drafts = Array.isArray(result.output.drafts)
    ? (result.output.drafts as Draft[])
    : [];
  await emit(
    ...findings.map((finding): RunEventInput => ({ type: "finding", finding })),
    ...drafts.map((draft): RunEventInput => ({ type: "draft", draft })),
    {
      type: "step.finished",
      stepId,
      status,
      output: result.output,
      usage: result.usage ?? null,
    },
  );
  await auditMany([
    {
      owner: ctx.owner,
      actor: actorFor(kind),
      action: "step.finished",
      summary: result.summary,
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      target: { kind: "step", id: stepId },
      detail: {
        pipelineId: ctx.pipelineId,
        stepId,
        status,
        findings: findings.length,
      },
      usage: result.usage ?? null,
    },
    ...findings.map((finding) => ({
      owner: ctx.owner,
      actor: { kind: "system" } as const,
      action: "finding.made" as const,
      summary: `${finding.ruleId} ${finding.met ? "met" : `not met (${finding.outcome})`}: ${finding.summary}`,
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      target: { kind: "rule", id: finding.ruleId },
      detail: {
        ruleId: finding.ruleId,
        ruleVersion: finding.ruleVersion,
        stepId,
        met: finding.met,
        outcome: finding.outcome,
      },
    })),
  ]);
}

/** Records a Step that failed, then ends it for good: a failed check is not retried. */
async function failed(
  ctx: RunContext,
  stepId: string,
  error: unknown,
): Promise<never> {
  const message = problemText(stepId, error);
  await markStepFinished(ctx.owner, ctx.runId, stepId, {
    status: "failed",
    error: message,
  });
  await emit({ type: "step.failed", stepId, error: message });
  await audit({
    owner: ctx.owner,
    actor: actorFor(stepKind(ctx, stepId)),
    action: "step.failed",
    summary: `${stepId}: ${message}`,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    target: { kind: "step", id: stepId },
    detail: { pipelineId: ctx.pipelineId, stepId },
  });
  throw new FatalError(message);
}

/**
 * Ends the workflow for good when its Run is no longer active: a person
 * stopped it, or the stale sweep closed it. Checked before any paid work, so
 * a Run marked over spends nothing more.
 */
async function assertRunActive(ctx: RunContext) {
  const row = await runRowOf(sql(), ctx.owner, ctx.runId);
  if (!row || !isRunActive(row.status)) {
    throw new FatalError("The Run is no longer active.");
  }
}

// Shared bodies --------------------------------------------------------------------------------

/**
 * Does a Step's work (for a model Step, the paid call) and returns what it
 * worked out; `save` saves it. Split in two so a failure while saving
 * retries the save, never the paid call: a workflow step's return value is
 * kept once the step succeeds.
 */
async function work(
  ctx: RunContext,
  stepId: string,
  deps: Deps,
): Promise<StepResult> {
  const execute = RUNNERS[ctx.pipelineId].steps[stepId];
  if (!execute) throw new FatalError(`No code for Step "${stepId}".`);
  await assertRunActive(ctx);
  await started(ctx, stepId);
  try {
    return await execute(ctx, deps);
  } catch (error) {
    return failed(ctx, stepId, error);
  }
}

/** Saves what `work` worked out: Findings, the Step's row, events, Audit. No model call, so it may retry freely. */
async function save(ctx: RunContext, stepId: string, result: StepResult) {
  await finished(ctx, stepId, result);
  return result.output;
}

function fanOf(ctx: RunContext, stepId: string) {
  const fan = RUNNERS[ctx.pipelineId].fanOut[stepId];
  if (!fan) throw new FatalError(`No code for Step "${stepId}".`);
  return fan;
}

async function fanList(
  ctx: RunContext,
  stepId: string,
  deps: Deps,
): Promise<unknown[]> {
  const fan = fanOf(ctx, stepId);
  await started(ctx, stepId);
  try {
    return fan.items(ctx, deps);
  } catch (error) {
    return failed(ctx, stepId, error);
  }
}

type FanValue = Awaited<ReturnType<FanOut<unknown, unknown>["one"]>>;

async function fanOne(
  ctx: RunContext,
  stepId: string,
  item: unknown,
  deps: Deps,
): Promise<FanValue> {
  const fan = fanOf(ctx, stepId);
  await assertRunActive(ctx);
  try {
    return await fan.one(ctx, item, deps);
  } catch (error) {
    return failed(ctx, stepId, error);
  }
}

async function fanSave(
  ctx: RunContext,
  stepId: string,
  values: { value: unknown; usage: AuditUsage | null }[],
  deps: Deps,
) {
  const fan = fanOf(ctx, stepId);
  let result: StepResult;
  try {
    result = fan.combine(
      ctx,
      values.map((item) => item.value),
      deps,
    );
  } catch (error) {
    return failed(ctx, stepId, error);
  }
  const usage = addUsage(
    values.flatMap((item) => (item.usage ? [item.usage] : [])),
  );
  await finished(ctx, stepId, { ...result, usage: result.usage ?? usage });
  return result.output;
}

// The Run's own steps --------------------------------------------------------------------------

export async function startRun(ctx: RunContext) {
  "use step";
  // False when the Run was stopped (or swept) before its workflow began.
  if (!(await setRunStatus(ctx.owner, ctx.runId, "running"))) {
    throw new FatalError("The Run is no longer active.");
  }
  const run = await loadRunView(ctx.owner, ctx.runId);
  if (!run) throw new FatalError("The Run is not in this Workspace.");
  await emit({ type: "run.started", run });
}

export async function askForApproval(
  ctx: RunContext,
  stepId: string,
  token: string,
  deps: Deps,
) {
  "use step";
  await started(ctx, stepId);
  try {
    const plan = RUNNERS[ctx.pipelineId].approval(ctx, deps);
    const approval = await openApproval(ctx.owner, ctx.runId, {
      ...plan,
      hookToken: token,
    });
    await setRunStatus(ctx.owner, ctx.runId, "waiting_approval");
    await emit({ type: "approval.requested", approval });
    await audit({
      owner: ctx.owner,
      actor: { kind: "system" },
      action: "approval.requested",
      summary: `${plan.risk === "high" ? "High" : "Low"}-risk Approval asked for: ${plan.title}`,
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      target: { kind: "approval", id: approval.id },
      detail: { kind: plan.kind, risk: plan.risk, stepId },
    });
    return { approvalId: approval.id };
  } catch (error) {
    return failed(ctx, stepId, error);
  }
}

/**
 * Settles the Approval once the hook fires or the wait runs out. On time-out
 * it claims the Approval as expired; if a person decided in the same moment,
 * their decision stands and is read back.
 */
export async function settleApproval(
  ctx: RunContext,
  stepId: string,
  token: string,
  approvalId: string,
  answer: ApprovalAnswer | null,
): Promise<ApprovalOutcome> {
  "use step";
  let outcome: ApprovalOutcome;
  if (answer) {
    outcome = { ...answer };
  } else if (await expireApproval(ctx.owner, approvalId)) {
    outcome = { approvalId, decision: "expired", note: null, decidedBy: null };
  } else {
    const decided = await approvalByToken(ctx.owner, ctx.runId, token);
    outcome = {
      approvalId,
      decision:
        decided?.status === "approved"
          ? "approve"
          : decided?.status === "returned"
            ? "return"
            : "expired",
      note: decided?.note ?? null,
      decidedBy: decided?.decidedBy ?? null,
    };
  }
  const stillActive = await setRunStatus(ctx.owner, ctx.runId, "running");
  if (!stillActive && outcome.decision === "approve") {
    // The Run was ended (failed or stopped) while it waited, e.g. a resume
    // that failed. The person's approval is kept as theirs, marked blocked:
    // nothing may be posted on behalf of a Run that is over (the next Step's
    // `assertRunActive` refuses too, and the workflow stops here).
    outcome = { ...outcome, blocked: "run_ended" };
  }
  await emit({
    type: "approval.decided",
    approvalId,
    status:
      outcome.decision === "approve"
        ? "approved"
        : outcome.decision === "return"
          ? "returned"
          : "expired",
    decidedBy: outcome.decidedBy,
    note: outcome.note,
    ...(outcome.blocked ? { blocked: outcome.blocked } : {}),
  });
  await finished(ctx, stepId, {
    output: { ...outcome },
    summary: approvalSummary(outcome),
  });
  return outcome;
}

/** One line for the Approval Step's output and its Audit event. */
export function approvalSummary(outcome: ApprovalOutcome): string {
  if (outcome.decision === "expired")
    return "No one decided the Approval in time.";
  const who = outcome.decidedBy?.name ?? "A person";
  if (outcome.blocked === "run_ended")
    return `${who} approved the Draft after the Run ended; nothing was posted.`;
  return `${who} ${outcome.decision === "approve" ? "approved" : "returned"} the Draft.`;
}

export async function finishRun(
  ctx: RunContext,
  outputs: Deps,
  status: "completed" | "returned" | "stopped",
) {
  "use step";
  const result = RUNNERS[ctx.pipelineId].result(ctx, outputs);
  const error =
    status === "stopped" ? "The Approval was not decided in time." : null;
  await setRunStatus(ctx.owner, ctx.runId, status, { result, error });
  await emit({ type: "run.finished", status, result, error });
  await audit({
    owner: ctx.owner,
    actor: { kind: "system" },
    action: "run.finished",
    summary: `Run ${status}${error ? `: ${error}` : ""}`,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    target: { kind: "run", id: ctx.runId },
    detail: { pipelineId: ctx.pipelineId, status, result },
  });
  await closeStream();
}

export async function failRun(ctx: RunContext, message: string) {
  "use step";
  const moved = await setRunStatus(ctx.owner, ctx.runId, "failed", {
    error: message,
  });
  // A Run someone stopped meanwhile keeps its own ending.
  if (moved) {
    await emit({
      type: "run.finished",
      status: "failed",
      result: null,
      error: message,
    });
    await audit({
      owner: ctx.owner,
      actor: { kind: "system" },
      action: "run.finished",
      summary: `Run failed: ${message}`,
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      target: { kind: "run", id: ctx.runId },
      detail: { pipelineId: ctx.pipelineId, status: "failed" },
    });
  }
  try {
    await closeStream();
  } catch {
    // Already closed by a Stop.
  }
}

// One pair per Step, named so the trace reads as the Pipeline ----------------------------------
// (Each body is one line on purpose: the name is the point. Keep them in Pipeline order.)

// Member request
export async function intake(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "intake", deps);
}
export async function saveIntake(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "intake", result);
}
export async function classify(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "classify", deps);
}
export async function saveClassify(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "classify", result);
}
export async function listDocuments(ctx: RunContext, deps: Deps) {
  "use step";
  return fanList(ctx, "read_documents", deps);
}
export async function readDocument(ctx: RunContext, item: unknown, deps: Deps) {
  "use step";
  return fanOne(ctx, "read_documents", item, deps);
}
export async function saveReadDocuments(
  ctx: RunContext,
  values: FanValue[],
  deps: Deps,
) {
  "use step";
  return fanSave(ctx, "read_documents", values, deps);
}
export async function findMember(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "find_member", deps);
}
export async function saveFindMember(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "find_member", result);
}
export async function checkIdentity(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "check_identity", deps);
}
export async function saveCheckIdentity(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "check_identity", result);
}
export async function checkEligibility(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "check_eligibility", deps);
}
export async function saveCheckEligibility(
  ctx: RunContext,
  result: StepResult,
) {
  "use step";
  return save(ctx, "check_eligibility", result);
}
export async function checkDocuments(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "check_documents", deps);
}
export async function saveCheckDocuments(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "check_documents", result);
}
export async function checkDeadline(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "check_deadline", deps);
}
export async function saveCheckDeadline(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "check_deadline", result);
}
export async function decide(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "decide", deps);
}
export async function saveDecide(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "decide", result);
}
export async function draft(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "draft", deps);
}
export async function saveDraft(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "draft", result);
}
export async function record(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "record", deps);
}
export async function saveRecord(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "record", result);
}

// Contribution processing
export async function parseSchedule(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "parse_schedule", deps);
}
export async function saveParseSchedule(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "parse_schedule", result);
}
export async function matchMembers(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "match_members", deps);
}
export async function saveMatchMembers(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "match_members", result);
}
export async function checkRates(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "check_rates", deps);
}
export async function saveCheckRates(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "check_rates", result);
}
export async function checkCap(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "check_cap", deps);
}
export async function saveCheckCap(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "check_cap", result);
}
export async function checkCoverage(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "check_coverage", deps);
}
export async function saveCheckCoverage(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "check_coverage", result);
}
export async function matchRemittance(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "match_remittance", deps);
}
export async function saveMatchRemittance(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "match_remittance", result);
}
export async function reconcile(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "reconcile", deps);
}
export async function saveReconcile(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "reconcile", result);
}
export async function draftQuery(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "draft_query", deps);
}
export async function saveDraftQuery(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "draft_query", result);
}
export async function post(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "post", deps);
}
export async function savePost(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "post", result);
}

// Delinquency report
export async function loadPeriod(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "load_period", deps);
}
export async function saveLoadPeriod(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "load_period", result);
}
export async function findMissing(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "find_missing", deps);
}
export async function saveFindMissing(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "find_missing", result);
}
export async function findLate(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "find_late", deps);
}
export async function saveFindLate(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "find_late", result);
}
export async function compute(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "compute", deps);
}
export async function saveCompute(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "compute", result);
}
export async function draftReport(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "draft_report", deps);
}
export async function saveDraftReport(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "draft_report", result);
}
export async function listChasers(ctx: RunContext, deps: Deps) {
  "use step";
  return fanList(ctx, "draft_chasers", deps);
}
export async function draftChaser(ctx: RunContext, item: unknown, deps: Deps) {
  "use step";
  return fanOne(ctx, "draft_chasers", item, deps);
}
export async function saveDraftChasers(
  ctx: RunContext,
  values: FanValue[],
  deps: Deps,
) {
  "use step";
  return fanSave(ctx, "draft_chasers", values, deps);
}
export async function file(ctx: RunContext, deps: Deps) {
  "use step";
  return work(ctx, "file", deps);
}
export async function saveFile(ctx: RunContext, result: StepResult) {
  "use step";
  return save(ctx, "file", result);
}

// Tables the workflow reads --------------------------------------------------------------------

type StepFunctions = {
  work: (ctx: RunContext, deps: Deps) => Promise<StepResult>;
  save: (ctx: RunContext, result: StepResult) => Promise<unknown>;
};

type FanFunctions = {
  list: (ctx: RunContext, deps: Deps) => Promise<unknown[]>;
  one: (ctx: RunContext, item: unknown, deps: Deps) => Promise<FanValue>;
  save: (ctx: RunContext, values: FanValue[], deps: Deps) => Promise<unknown>;
};

/** A Step's work and save, by Step id (ids are unique across the Pipelines). */
export const STEP_FUNCTIONS: Record<string, StepFunctions> = {
  intake: { work: intake, save: saveIntake },
  classify: { work: classify, save: saveClassify },
  find_member: { work: findMember, save: saveFindMember },
  check_identity: { work: checkIdentity, save: saveCheckIdentity },
  check_eligibility: { work: checkEligibility, save: saveCheckEligibility },
  check_documents: { work: checkDocuments, save: saveCheckDocuments },
  check_deadline: { work: checkDeadline, save: saveCheckDeadline },
  decide: { work: decide, save: saveDecide },
  draft: { work: draft, save: saveDraft },
  record: { work: record, save: saveRecord },
  parse_schedule: { work: parseSchedule, save: saveParseSchedule },
  match_members: { work: matchMembers, save: saveMatchMembers },
  check_rates: { work: checkRates, save: saveCheckRates },
  check_cap: { work: checkCap, save: saveCheckCap },
  check_coverage: { work: checkCoverage, save: saveCheckCoverage },
  match_remittance: { work: matchRemittance, save: saveMatchRemittance },
  reconcile: { work: reconcile, save: saveReconcile },
  draft_query: { work: draftQuery, save: saveDraftQuery },
  post: { work: post, save: savePost },
  load_period: { work: loadPeriod, save: saveLoadPeriod },
  find_missing: { work: findMissing, save: saveFindMissing },
  find_late: { work: findLate, save: saveFindLate },
  compute: { work: compute, save: saveCompute },
  draft_report: { work: draftReport, save: saveDraftReport },
  file: { work: file, save: saveFile },
};

/** Steps that do one piece of work per item (a model call per paper), by Step id. */
export const FAN_FUNCTIONS: Record<string, FanFunctions> = {
  read_documents: {
    list: listDocuments,
    one: readDocument,
    save: saveReadDocuments,
  },
  draft_chasers: {
    list: listChasers,
    one: draftChaser,
    save: saveDraftChasers,
  },
};

type Retryable = { maxRetries?: number };

// A Step that failed in its own code is not retried (`failed` throws a
// FatalError). What is left is a lost connection before or after the work;
// one retry, since a retry after a model call that went through pays again.
// A save makes no model call, so it may retry freely.
for (const step of Object.values(STEP_FUNCTIONS)) {
  (step.work as Retryable).maxRetries = 1;
  (step.save as Retryable).maxRetries = 3;
}
// One paid call per item and nothing saved after it (the fan's save
// records), so a retry only follows a lost connection; one is enough.
for (const fan of Object.values(FAN_FUNCTIONS)) {
  (fan.one as Retryable).maxRetries = 1;
}
