import { createHook, FatalError, sleep } from "workflow";
import type { AuditUsage } from "../domain/audit";
import { levels, type StepSpec, upstream } from "../domain/pipeline";
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
  type RunContext,
  StepProblem,
  type StepResult,
} from "./pipelines/types";

/*
 * One Run of a Pipeline on the Workflow SDK (ADR 0007, as Casework does it).
 * The workflow walks `levels(spec)`: every Step of a level runs at the same
 * time, and a Step that reads several papers or drafts several chasers fans
 * out inside itself. Each Step is a `"use step"` function that records its
 * row, its Findings and its Audit events and streams what happened. The
 * Approval waits on a hook a person resumes from `decideApproval`.
 *
 * Only pure domain code runs in the workflow body; everything that touches
 * the database or a model is inside a step.
 */

/** How long an Approval waits for a person before the Run stops without it. */
const APPROVAL_WAIT = "24h";

/** Steps that do one piece of work per item, by Pipeline. */
const FAN_OUT: Record<string, string[]> = {
  member_request: ["read_documents"],
  delinquency_report: ["draft_chasers"],
};

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

// Steps --------------------------------------------------------------------------------------

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

export async function beginStep(ctx: RunContext) {
  "use step";
  // False when the Run was stopped (or swept) before its workflow began.
  if (!(await setRunStatus(ctx.owner, ctx.runId, "running"))) {
    throw new FatalError("The Run is no longer active.");
  }
  const run = await loadRunView(ctx.owner, ctx.runId);
  if (!run) throw new FatalError("The Run is not in this Workspace.");
  await emit({ type: "run.started", run });
}

/**
 * Does a Step's work (for a model Step, the paid call) and returns what it
 * worked out; `recordStep` saves it. Split in two so a failure while saving
 * retries the save, never the paid call: a workflow step's return value is
 * kept once the step succeeds.
 */
export async function workStep(
  ctx: RunContext,
  stepId: string,
  deps: Deps,
): Promise<StepResult> {
  "use step";
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

// A Step that failed in its own code is not retried (`failed` throws a
// FatalError). What is left is a lost connection before or after the work;
// one retry, since a retry after a model call that went through pays again.
workStep.maxRetries = 1;

/** Saves what `workStep` worked out: Findings, the Step's row, events, Audit. No model call, so it may retry freely. */
export async function recordStep(
  ctx: RunContext,
  stepId: string,
  result: StepResult,
) {
  "use step";
  await finished(ctx, stepId, result);
  return result.output;
}

recordStep.maxRetries = 3;

async function fanStartStep(
  ctx: RunContext,
  stepId: string,
  deps: Deps,
): Promise<unknown[]> {
  "use step";
  const fan = RUNNERS[ctx.pipelineId].fanOut[stepId];
  if (!fan) throw new FatalError(`No code for Step "${stepId}".`);
  await started(ctx, stepId);
  try {
    return fan.items(ctx, deps);
  } catch (error) {
    return failed(ctx, stepId, error);
  }
}

export async function fanItemStep(
  ctx: RunContext,
  stepId: string,
  item: unknown,
  deps: Deps,
) {
  "use step";
  const fan = RUNNERS[ctx.pipelineId].fanOut[stepId];
  if (!fan) throw new FatalError(`No code for Step "${stepId}".`);
  await assertRunActive(ctx);
  try {
    return await fan.one(ctx, item, deps);
  } catch (error) {
    return failed(ctx, stepId, error);
  }
}

// One paid call per item and nothing saved after it (`fanEndStep` records), so
// a retry only follows a lost connection; one is enough.
fanItemStep.maxRetries = 1;

async function fanEndStep(
  ctx: RunContext,
  stepId: string,
  values: { value: unknown; usage: AuditUsage | null }[],
  deps: Deps,
) {
  "use step";
  const fan = RUNNERS[ctx.pipelineId].fanOut[stepId];
  if (!fan) throw new FatalError(`No code for Step "${stepId}".`);
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

async function requestApprovalStep(
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
async function settleApprovalStep(
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
    // `assertRunActive` refuses too, and `harnessRun` stops here).
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

async function finishStep(
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

async function failStep(ctx: RunContext, message: string) {
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

// Orchestration ----------------------------------------------------------------------------------

function pick(outputs: Deps, ids: string[]): Deps {
  const deps: Deps = {};
  for (const id of ids) if (id in outputs) deps[id] = outputs[id];
  return deps;
}

async function approvalFlow(
  ctx: RunContext,
  stepId: string,
  deps: Deps,
): Promise<ApprovalOutcome> {
  const token = `harness:${ctx.runId}:${stepId}`;
  const hook = createHook<ApprovalAnswer>({ token });
  // Register the hook before anyone can see the Approval and decide it.
  await hook.getConflict();
  const { approvalId } = await requestApprovalStep(ctx, stepId, token, deps);
  const answer = await Promise.race([
    hook.then((payload) => payload),
    sleep(APPROVAL_WAIT).then(() => null),
  ]);
  return settleApprovalStep(ctx, stepId, token, approvalId, answer);
}

async function runOne(
  ctx: RunContext,
  step: StepSpec,
  deps: Deps,
): Promise<unknown> {
  if (step.kind === "approval") return approvalFlow(ctx, step.id, deps);
  if (FAN_OUT[ctx.pipelineId]?.includes(step.id)) {
    const items = await fanStartStep(ctx, step.id, deps);
    const values = await Promise.all(
      items.map((item) => fanItemStep(ctx, step.id, item, deps)),
    );
    return fanEndStep(ctx, step.id, values, deps);
  }
  const result = await workStep(ctx, step.id, deps);
  return recordStep(ctx, step.id, result);
}

/**
 * One Run. Every Step of a level runs at the same time; a level waits for
 * all of its Steps (even when one fails) before the Run moves on or ends.
 */
export async function harnessRun(ctx: RunContext) {
  "use workflow";
  try {
    const spec = pipelineOf(ctx.pipelineId);
    if (!spec) throw new Error(`No Pipeline "${ctx.pipelineId}".`);
    await beginStep(ctx);
    const outputs: Deps = {};
    for (const level of levels(spec)) {
      const settled = await Promise.allSettled(
        level.map((step) =>
          runOne(ctx, step, pick(outputs, upstream(spec, step.id))),
        ),
      );
      for (const [index, outcome] of settled.entries()) {
        const step = level[index];
        if (!step) continue;
        if (outcome.status === "rejected") throw outcome.reason;
        outputs[step.id] = outcome.value;
      }
      // Approved after the Run ended: no Step after the Approval may run.
      if ((outputs.approval as ApprovalOutcome | undefined)?.blocked) {
        throw new Error("The Run had ended before it was approved.");
      }
    }
    const approval = outputs.approval as ApprovalOutcome | undefined;
    const status =
      approval?.decision === "return"
        ? "returned"
        : approval?.decision === "expired"
          ? "stopped"
          : "completed";
    await finishStep(ctx, outputs, status);
    return { runId: ctx.runId, status };
  } catch (error) {
    await failStep(ctx, error instanceof Error ? error.message : String(error));
    return { runId: ctx.runId, status: "failed" as const };
  }
}
