import { createHook, sleep } from "workflow";
import {
  levels,
  type PipelineId,
  type StepSpec,
  upstream,
} from "../domain/pipeline";
import { pipelineOf } from "../domain/pipelines/index";
import type {
  ApprovalAnswer,
  ApprovalOutcome,
  Deps,
  RunContext,
} from "./pipelines/types";
import {
  askForApproval,
  FAN_FUNCTIONS,
  failRun,
  finishRun,
  STEP_FUNCTIONS,
  settleApproval,
  startRun,
} from "./run-steps";

/*
 * One Run of a Pipeline on the Workflow SDK (ADR 0007, as Casework does it).
 * The workflow walks `levels(spec)`: every Step of a level runs at the same
 * time, and a Step that reads several papers or drafts several chasers fans
 * out inside itself. Each Step's step functions (`run-steps.ts`) record its
 * row, its Findings and its Audit events and stream what happened. The
 * Approval waits on a hook a person resumes from `decideApproval`.
 *
 * Each Pipeline has its own workflow (`memberRequest`, ...) and each Step its
 * own step functions (`classify`, `saveClassify`, ...), because the SDK names
 * a run and a step after its function: the Vercel Workflow trace then reads
 * as the Pipeline, not as `harnessRun`, `workStep`, `recordStep`.
 *
 * Only pure domain code runs in the workflow body; everything that touches
 * the database or a model is inside a step.
 */

/** How long an Approval waits for a person before the Run stops without it. */
const APPROVAL_WAIT = "24h";

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
  const { approvalId } = await askForApproval(ctx, stepId, token, deps);
  const answer = await Promise.race([
    hook.then((payload) => payload),
    sleep(APPROVAL_WAIT).then(() => null),
  ]);
  return settleApproval(ctx, stepId, token, approvalId, answer);
}

async function runOne(
  ctx: RunContext,
  step: StepSpec,
  deps: Deps,
): Promise<unknown> {
  if (step.kind === "approval") return approvalFlow(ctx, step.id, deps);
  const fan = FAN_FUNCTIONS[step.id];
  if (fan) {
    const items = await fan.list(ctx, deps);
    const values = await Promise.all(
      items.map((item) => fan.one(ctx, item, deps)),
    );
    return fan.save(ctx, values, deps);
  }
  const named = STEP_FUNCTIONS[step.id];
  if (!named) throw new Error(`No step function for Step "${step.id}".`);
  const result = await named.work(ctx, deps);
  return named.save(ctx, result);
}

/**
 * One Run. Every Step of a level runs at the same time; a level waits for
 * all of its Steps (even when one fails) before the Run moves on or ends.
 * Plain code, called by each Pipeline's workflow below.
 */
async function runPipeline(ctx: RunContext) {
  try {
    const spec = pipelineOf(ctx.pipelineId);
    if (!spec) throw new Error(`No Pipeline "${ctx.pipelineId}".`);
    await startRun(ctx);
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
    await finishRun(ctx, outputs, status);
    return { runId: ctx.runId, status };
  } catch (error) {
    await failRun(ctx, error instanceof Error ? error.message : String(error));
    return { runId: ctx.runId, status: "failed" as const };
  }
}

export async function memberRequest(ctx: RunContext) {
  "use workflow";
  return runPipeline(ctx);
}

export async function contributionProcessing(ctx: RunContext) {
  "use workflow";
  return runPipeline(ctx);
}

export async function delinquencyReport(ctx: RunContext) {
  "use workflow";
  return runPipeline(ctx);
}

/** The workflow that runs each Pipeline. */
export const PIPELINE_WORKFLOWS: Record<
  PipelineId,
  (ctx: RunContext) => Promise<{ runId: string; status: string }>
> = {
  member_request: memberRequest,
  contribution_processing: contributionProcessing,
  delinquency_report: delinquencyReport,
};
