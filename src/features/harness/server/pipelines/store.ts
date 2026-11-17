import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditUsage } from "../../domain/audit";
import type { ApprovalRisk } from "../../domain/permissions";
import type { PipelineId } from "../../domain/pipeline";
import type { FindingDraft } from "../../domain/pipelines/apply";
import { pipelineOf, subjectOf } from "../../domain/pipelines/index";
import type { Outcome } from "../../domain/rules";
import {
  ACTIVE_RUN_STATUSES,
  type ApprovalStatus,
  type ApprovalView,
  type Draft,
  type Finding,
  type RunStatus,
  type RunSummary,
  type RunView,
  type StartedVia,
  type StepStatus,
  type StepView,
} from "../../domain/run";
import { type Db, isUuid, jsonb, sql } from "../db";

/*
 * The Runs' rows: `harness.runs`, `run_steps`, `findings` and `approvals`.
 * Every query names the Owner as well as the id, so nothing here reaches
 * another Workspace even when handed a wrong id. Status changes on a Run are
 * guarded on it still being active, so a Step that finishes after a Stop
 * cannot bring the Run back to life.
 */

type RunRow = {
  id: string;
  session_id: string | null;
  pipeline_id: PipelineId;
  workflow_run_id: string | null;
  status: RunStatus;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  rule_versions: Record<string, number>;
  started_by: string;
  started_by_name: string;
  started_via: StartedVia;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
};

const RUN_SELECT = `
  r.id, r.session_id, r.pipeline_id, r.workflow_run_id, r.status, r.input,
  r.result, r.rule_versions, r.started_by, s.name as started_by_name,
  r.started_via, r.error, r.created_at, r.updated_at, r.finished_at`;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function summaryOf(row: RunRow): RunSummary {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    sessionId: row.session_id,
    status: row.status,
    subject: subjectOf(row.pipeline_id, row.input ?? {}, row.result),
    startedBy: { id: row.started_by, name: row.started_by_name },
    startedVia: row.started_via,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    finishedAt: iso(row.finished_at),
  };
}

/** The Run's row with who started it, or null when it is not the Owner's. */
export async function runRowOf(
  db: Db,
  owner: Owner,
  runId: string,
): Promise<RunRow | null> {
  if (!isUuid(runId)) return null;
  const [row] = await db.unsafe<RunRow[]>(
    `select ${RUN_SELECT}
     from harness.runs r join harness.staff s on s.id = r.started_by
     where r.owner = $1 and r.id = $2::uuid`,
    [owner, runId],
  );
  return row ?? null;
}

export type { RunRow };

type StepRow = {
  step_id: string;
  status: StepStatus;
  started_at: Date | null;
  finished_at: Date | null;
  output: unknown;
  error: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
};

type FindingRow = {
  id: string;
  rule_id: string;
  rule_version: number;
  step_id: string;
  met: boolean;
  outcome: Outcome;
  summary: string;
  compared: Record<string, unknown>;
  created_at: Date;
};

const findingOf = (row: FindingRow): Finding => ({
  id: row.id,
  ruleId: row.rule_id,
  ruleVersion: row.rule_version,
  stepId: row.step_id,
  met: row.met,
  outcome: row.outcome,
  summary: row.summary,
  compared: row.compared ?? {},
  createdAt: row.created_at.toISOString(),
});

type ApprovalRow = {
  id: string;
  run_id: string;
  kind: string;
  risk: ApprovalRisk;
  title: string;
  draft: Draft;
  status: ApprovalStatus;
  hook_token: string | null;
  requested_at: Date;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  note: string | null;
};

export const approvalOf = (row: ApprovalRow): ApprovalView => ({
  id: row.id,
  // Every Pipeline has one Approval Step, and it is called `approval`.
  stepId: "approval",
  kind: row.kind,
  risk: row.risk,
  title: row.title,
  draft: row.draft,
  status: row.status,
  requestedAt: row.requested_at.toISOString(),
  decidedBy:
    row.decided_by && row.decided_by_name
      ? { id: row.decided_by, name: row.decided_by_name }
      : null,
  decidedAt: iso(row.decided_at),
  note: row.note,
});

const usageOfRow = (row: StepRow): AuditUsage | null =>
  row.model
    ? {
        model: row.model,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      }
    : null;

function draftsIn(output: unknown): Draft[] {
  if (!output || typeof output !== "object") return [];
  const drafts = (output as { drafts?: unknown }).drafts;
  return Array.isArray(drafts) ? (drafts as Draft[]) : [];
}

/** A Run with everything the Pipeline view draws, or null when it is not the Owner's. */
export async function loadRunView(
  owner: Owner,
  runId: string,
): Promise<RunView | null> {
  const db = sql();
  const row = await runRowOf(db, owner, runId);
  if (!row) return null;
  const [steps, findings, approvals] = await Promise.all([
    db<StepRow[]>`
      select step_id, status, started_at, finished_at, output, error, model,
             input_tokens, output_tokens, cost_usd
      from harness.run_steps
      where owner = ${owner} and run_id = ${row.id}`,
    db<FindingRow[]>`
      select id, rule_id, rule_version, step_id, met, outcome, summary, compared, created_at
      from harness.findings
      where owner = ${owner} and run_id = ${row.id}
      order by created_at, rule_id`,
    db<ApprovalRow[]>`
      select a.id, a.run_id, a.kind, a.risk, a.title, a.draft, a.status, a.hook_token,
             a.requested_at, a.decided_by, s.name as decided_by_name, a.decided_at, a.note
      from harness.approvals a
      left join harness.staff s on s.id = a.decided_by
      where a.owner = ${owner} and a.run_id = ${row.id}
      order by a.requested_at`,
  ]);
  const spec = pipelineOf(row.pipeline_id);
  const byId = new Map(steps.map((step) => [step.step_id, step]));
  const order = spec
    ? spec.steps.map((step) => step.id)
    : steps.map((step) => step.step_id);
  const stepViews: StepView[] = order.map((stepId) => {
    const step = byId.get(stepId);
    return {
      stepId,
      status: step?.status ?? "pending",
      startedAt: iso(step?.started_at ?? null),
      finishedAt: iso(step?.finished_at ?? null),
      output: step?.output ?? null,
      error: step?.error ?? null,
      usage: step ? usageOfRow(step) : null,
    };
  });
  return {
    ...summaryOf(row),
    input: row.input ?? {},
    result: row.result,
    error: row.error,
    ruleVersions: row.rule_versions ?? {},
    steps: stepViews,
    findings: findings.map(findingOf),
    approvals: approvals.map(approvalOf),
    drafts: stepViews.flatMap((step) => draftsIn(step.output)),
  };
}

/** The Workspace's Runs, newest first. */
export async function listRunSummaries(
  owner: Owner,
  filter: { sessionId?: string | null; limit?: number },
): Promise<RunSummary[]> {
  if (filter.sessionId && !isUuid(filter.sessionId)) return [];
  const limit = Math.max(
    1,
    Math.min(Math.trunc(filter.limit ?? 50) || 50, 200),
  );
  const rows = await sql().unsafe<RunRow[]>(
    `select ${RUN_SELECT}
     from harness.runs r join harness.staff s on s.id = r.started_by
     where r.owner = $1 and ($2::uuid is null or r.session_id = $2::uuid)
     order by r.created_at desc
     limit $3`,
    [owner, filter.sessionId ?? null, limit],
  );
  return rows.map(summaryOf);
}

// Writes ---------------------------------------------------------------------------------

/** Moves an active Run to a new status; does nothing once it has ended. Returns whether it moved. */
export async function setRunStatus(
  owner: Owner,
  runId: string,
  status: RunStatus,
  extra: {
    result?: Record<string, unknown> | null;
    error?: string | null;
  } = {},
): Promise<boolean> {
  const db = sql();
  const ending = !ACTIVE_RUN_STATUSES.includes(status);
  const rows = await db`
    update harness.runs set
      status = ${status},
      updated_at = now(),
      ${extra.result !== undefined ? db`result = ${extra.result === null ? null : jsonb(db, extra.result)},` : db``}
      ${extra.error !== undefined ? db`error = ${extra.error?.slice(0, 1000) ?? null},` : db``}
      finished_at = ${ending ? db`now()` : db`finished_at`}
    where owner = ${owner} and id = ${runId}
      and status in ${db(ACTIVE_RUN_STATUSES)}
    returning id`;
  return rows.length > 0;
}

export async function markStepRunning(
  owner: Owner,
  runId: string,
  stepId: string,
) {
  await sql()`
    insert into harness.run_steps (run_id, step_id, owner, status, started_at)
    values (${runId}, ${stepId}, ${owner}, 'running', now())
    on conflict (run_id, step_id) do update
      set status = 'running', started_at = now(), finished_at = null, error = null`;
}

export async function markStepFinished(
  owner: Owner,
  runId: string,
  stepId: string,
  done: {
    status: "done" | "skipped" | "failed";
    output?: unknown;
    error?: string | null;
    usage?: AuditUsage | null;
  },
) {
  const db = sql();
  const usage = done.usage ?? null;
  await db`
    insert into harness.run_steps (
      run_id, step_id, owner, status, started_at, finished_at, output, error,
      model, input_tokens, output_tokens, cost_usd
    ) values (
      ${runId}, ${stepId}, ${owner}, ${done.status}, now(), now(),
      ${done.output === undefined ? null : jsonb(db, done.output)},
      ${done.error?.slice(0, 1000) ?? null},
      ${usage?.model ?? null},
      ${usage ? Math.round(usage.inputTokens) : null},
      ${usage ? Math.round(usage.outputTokens) : null},
      ${usage?.costUsd ?? null}
    )
    on conflict (run_id, step_id) do update set
      status = excluded.status,
      started_at = coalesce(harness.run_steps.started_at, excluded.started_at),
      finished_at = excluded.finished_at,
      output = excluded.output,
      error = excluded.error,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cost_usd = excluded.cost_usd`;
}

/**
 * Saves a Step's Findings. One per Rule per Run (`unique (run_id, rule_id)`):
 * a retried Step overwrites its own, so a retry never doubles them.
 */
export async function saveFindings(
  owner: Owner,
  runId: string,
  drafts: FindingDraft[],
): Promise<Finding[]> {
  if (drafts.length === 0) return [];
  const db = sql();
  const rows = await db<FindingRow[]>`
    insert into harness.findings ${db(
      drafts.map((finding) => ({
        run_id: runId,
        owner,
        rule_id: finding.ruleId,
        rule_version: finding.ruleVersion,
        step_id: finding.stepId,
        met: finding.met,
        outcome: finding.outcome,
        summary: finding.summary.slice(0, 2000),
        compared: jsonb(db, finding.compared),
      })),
    )}
    on conflict (run_id, rule_id) do update set
      rule_version = excluded.rule_version,
      step_id = excluded.step_id,
      met = excluded.met,
      outcome = excluded.outcome,
      summary = excluded.summary,
      compared = excluded.compared
    returning id, rule_id, rule_version, step_id, met, outcome, summary, compared, created_at`;
  const order = new Map(
    drafts.map((finding, index) => [finding.ruleId, index]),
  );
  return rows
    .map(findingOf)
    .sort((a, b) => (order.get(a.ruleId) ?? 0) - (order.get(b.ruleId) ?? 0));
}

/** Opens the Approval a Run waits on. A retried Step finds the one it already opened. */
export async function openApproval(
  owner: Owner,
  runId: string,
  input: {
    kind: string;
    risk: ApprovalRisk;
    title: string;
    draft: Draft;
    hookToken: string;
  },
): Promise<ApprovalView> {
  const db = sql();
  const [existing] = await db<{ id: string }[]>`
    select id from harness.approvals
    where owner = ${owner} and run_id = ${runId} and hook_token = ${input.hookToken}`;
  if (!existing) {
    await db`
      insert into harness.approvals (run_id, owner, kind, risk, title, draft, hook_token)
      values (${runId}, ${owner}, ${input.kind}, ${input.risk}, ${input.title.slice(0, 300)},
              ${jsonb(db, input.draft)}, ${input.hookToken})`;
  }
  const approval = await approvalByToken(owner, runId, input.hookToken);
  if (!approval) throw new Error("The Approval was not saved");
  return approval;
}

export async function approvalByToken(
  owner: Owner,
  runId: string,
  hookToken: string,
): Promise<ApprovalView | null> {
  const [row] = await sql()<ApprovalRow[]>`
    select a.id, a.run_id, a.kind, a.risk, a.title, a.draft, a.status, a.hook_token,
           a.requested_at, a.decided_by, s.name as decided_by_name, a.decided_at, a.note
    from harness.approvals a
    left join harness.staff s on s.id = a.decided_by
    where a.owner = ${owner} and a.run_id = ${runId} and a.hook_token = ${hookToken}`;
  return row ? approvalOf(row) : null;
}

/** Marks a pending Approval expired. Returns false when a person decided it first. */
export async function expireApproval(
  owner: Owner,
  approvalId: string,
): Promise<boolean> {
  const rows = await sql()`
    update harness.approvals set status = 'expired'
    where owner = ${owner} and id = ${approvalId} and status = 'pending'
    returning id`;
  return rows.length > 0;
}

/** Expires every pending Approval of a Run: a stopped Run can no longer be approved. */
export async function expireRunApprovals(db: Db, owner: Owner, runId: string) {
  await db`
    update harness.approvals set status = 'expired'
    where owner = ${owner} and run_id = ${runId} and status = 'pending'`;
}

export type { ApprovalRow };
