import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { ModelCall, ModelChoice, Purpose } from "../domain/models";
import type { Process, Watch } from "../domain/process";
import type { CheckResult, ReviewFinding, Rule } from "../domain/rules";
import type {
  Approval,
  AuditAction,
  AuditEvent,
  DeckRound,
  RunLog,
  RunPatch,
  RunSource,
  RunStatus,
  RunSummary,
  RunView,
  StageState,
} from "../domain/run";
import { sql } from "./db";

/*
 * Every list and every load by id here takes the Owner and filters on it in
 * SQL. The only reads without an Owner are the pipeline's own (`pipeline*`),
 * which take a Run id the server wrote into the workflow's input itself.
 */

/** Logs kept on a Run's row; the stream has them all. */
const MAX_LOGS = 300;

// biome-ignore lint/suspicious/noExplicitAny: postgres.js's JSON parameter type is narrower than our data.
const json = (value: unknown) => sql().json(value as any);

export type RunRow = {
  id: string;
  owner: string;
  visitor_hash: string;
  source_kind: "sample" | "upload";
  sample_slug: string | null;
  recording_path: string | null;
  recording_name: string | null;
  recording_type: string | null;
  status: RunStatus;
  title: string;
  workflow_run_id: string | null;
  stages: StageState[];
  watch: Watch | null;
  process: Process | null;
  process_checks: CheckResult[];
  process_findings: ReviewFinding[];
  rounds: DeckRound[];
  approval: Approval | null;
  /** The grounding Check as Verify computed it; kept for every later Redo. */
  grounding: CheckResult | null;
  rules: Rule[];
  rules_version: number;
  models: ModelChoice;
  logs: RunLog[];
  cost_usd: string | number;
  redos: number;
  error: string | null;
  created_at: Date;
  started_at: Date;
  completed_at: Date | null;
};

export function sourceOf(
  row: Pick<RunRow, "source_kind" | "sample_slug" | "recording_name">,
): RunSource {
  return row.source_kind === "sample"
    ? { kind: "sample", slug: row.sample_slug ?? "" }
    : { kind: "upload", name: row.recording_name ?? "Recording" };
}

export function toRunView(
  row: RunRow,
  calls: ModelCall[],
  videoUrl: string | null,
): RunView {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    source: sourceOf(row),
    videoUrl,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    stages: row.stages,
    watch: row.watch,
    process: row.process,
    processChecks: row.process_checks,
    processFindings: row.process_findings,
    rounds: row.rounds,
    approval: row.approval,
    calls,
    costUsd: Number(row.cost_usd),
    rules: row.rules,
    rulesVersion: row.rules_version,
    models: row.models,
    logs: row.logs,
    error: row.error,
  };
}

// Runs -------------------------------------------------------------------------

export async function createRun(input: {
  owner: Owner;
  visitorHash: string;
  source:
    | { kind: "sample"; slug: string }
    | { kind: "upload"; path: string; name: string; type: string };
  title: string;
  stages: StageState[];
  rules: Rule[];
  rulesVersion: number;
  models: ModelChoice;
}): Promise<string> {
  const { source } = input;
  const [row] = await sql()<{ id: string }[]>`
    insert into process_transfer.runs (
      owner, visitor_hash, source_kind, sample_slug, recording_path,
      recording_name, recording_type, title, stages, rules, rules_version, models
    ) values (
      ${input.owner}, ${input.visitorHash}, ${source.kind},
      ${source.kind === "sample" ? source.slug : null},
      ${source.kind === "upload" ? source.path : null},
      ${source.kind === "upload" ? source.name : null},
      ${source.kind === "upload" ? source.type : null},
      ${input.title}, ${json(input.stages)}, ${json(input.rules)},
      ${input.rulesVersion}, ${json(input.models)}
    )
    returning id`;
  return row.id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One of the Owner's Runs, or null. An id that is not a uuid is simply not found. */
export async function ownedRun(
  owner: Owner,
  id: string,
): Promise<RunRow | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const [row] = await sql()<RunRow[]>`
    select * from process_transfer.runs where id = ${id} and owner = ${owner}`;
  return row ?? null;
}

/** The pipeline's own read of the Run it is working on. */
export async function pipelineRun(id: string): Promise<RunRow | null> {
  const [row] = await sql()<RunRow[]>`
    select * from process_transfer.runs where id = ${id}`;
  return row ?? null;
}

/** The Run's status as this generation of its pipeline sees it: null once a Redo has replaced it. */
export async function pipelineStatus(
  id: string,
  generation: number,
): Promise<RunStatus | null> {
  const [row] = await sql()<{ status: RunStatus }[]>`
    select status from process_transfer.runs
    where id = ${id} and redos = ${generation}`;
  return row?.status ?? null;
}

/** Starts a generation of the pipeline: false when the Run was stopped or redone meanwhile. */
export async function claimRun(id: string, generation: number) {
  const rows = await sql()`
    update process_transfer.runs set status = 'running'
    where id = ${id} and redos = ${generation}
      and status in ('queued', 'running')
    returning id`;
  return rows.length > 0;
}

/** The message a person sees when the one-active-Run gate refuses. */
export const ACTIVE_RUN_MESSAGE =
  "A Run is still going. Stop it or let it finish before starting another.";

/** The unique index that keeps one active Run per Owner was hit. */
export function isActiveRunConflict(error: unknown) {
  const pg = error as { code?: string; constraint_name?: string } | null;
  return pg?.code === "23505" && pg.constraint_name === "runs_one_active_idx";
}

export async function listRuns(
  owner: Owner,
  limit = 50,
): Promise<RunSummary[]> {
  const rows = await sql()<
    (Pick<
      RunRow,
      | "id"
      | "title"
      | "status"
      | "source_kind"
      | "sample_slug"
      | "recording_name"
      | "created_at"
      | "cost_usd"
    > & {
      steps: number | null;
      slides: number | null;
      approval_status: Approval["status"] | null;
    })[]
  >`
    select id, title, status, source_kind, sample_slug, recording_name,
      created_at, cost_usd,
      case when process is null then null
        else jsonb_array_length(process -> 'steps') end as steps,
      case when jsonb_array_length(rounds) = 0 then null
        else jsonb_array_length(rounds -> -1 -> 'deck' -> 'slides') end as slides,
      approval ->> 'status' as approval_status
    from process_transfer.runs
    where owner = ${owner}
    order by created_at desc
    limit ${limit}`;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    source: sourceOf(row),
    createdAt: row.created_at.toISOString(),
    costUsd: Number(row.cost_usd),
    steps: row.steps,
    slides: row.slides,
    approval: row.approval_status,
  }));
}

export async function activeRuns(owner: Owner): Promise<RunRow[]> {
  return sql()<RunRow[]>`
    select * from process_transfer.runs
    where owner = ${owner} and status in ('queued', 'running')
    order by created_at desc`;
}

const PATCH_COLUMNS = {
  title: "title",
  status: "status",
  stages: "stages",
  watch: "watch",
  process: "process",
  processChecks: "process_checks",
  processFindings: "process_findings",
  rounds: "rounds",
  approval: "approval",
  completedAt: "completed_at",
  error: "error",
} as const satisfies Partial<Record<keyof RunPatch, string>>;

const JSON_COLUMNS = new Set([
  "stages",
  "watch",
  "process",
  "process_checks",
  "process_findings",
  "rounds",
  "approval",
]);

/**
 * Writes a patch the workflow streamed onto the row, with any columns only
 * the row keeps (`rowOnly`). Cost is not taken from the patch: it is added
 * up in SQL as each call is recorded. Returns false, having written nothing,
 * when the Run is no longer going or a Redo replaced this generation.
 */
export async function patchRun(
  id: string,
  generation: number,
  patch: RunPatch,
  rowOnly: { grounding?: CheckResult | null } = {},
): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if ("grounding" in rowOnly) {
    row.grounding = rowOnly.grounding ? json(rowOnly.grounding) : null;
  }
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    if (!(key in patch)) continue;
    const value = patch[key as keyof RunPatch];
    row[column] =
      JSON_COLUMNS.has(column) && value !== null ? json(value) : value;
  }
  const columns = Object.keys(row);
  if (columns.length === 0) {
    // Nothing to write (a log line, a cost): still answer whether this pass
    // owns a going Run, so a stale step's lines reach neither row nor stream.
    const going = await sql()`
      select 1 from process_transfer.runs
      where id = ${id} and redos = ${generation}
        and status in ('queued', 'running')`;
    return going.length > 0;
  }
  // One statement, applied only while this pass still owns a going Run: a
  // Stop, a stale-run failure or a Redo in between makes it a no-op.
  const applied = await sql()`
    update process_transfer.runs set ${sql()(row, columns)}
    where id = ${id} and redos = ${generation}
      and status in ('queued', 'running')
    returning id`;
  return applied.length > 0;
}

/** Fields only the server sets: never from a stream. */
export async function setRunFields(
  id: string,
  fields: Partial<{
    workflow_run_id: string | null;
    status: RunStatus;
    error: string | null;
    completed_at: Date | null;
  }>,
) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  // Only a Run that is still going: a Stop that got there first stands.
  await sql()`
    update process_transfer.runs set ${sql()(fields, columns)}
    where id = ${id} and status in ('queued', 'running')`;
}

/**
 * Ends a Run that is still going, whatever else happened to it: stopped by
 * the person, or failed when its pipeline stopped responding. A stage that
 * was running is marked failed with the reason, the rest skipped. Returns
 * the row as it now is, or null when it was not going.
 */
export async function markStopped(
  id: string,
  owner: Owner,
  reason = "Stopped by the person.",
  status: "stopped" | "failed" = "stopped",
): Promise<RunRow | null> {
  const [row] = await sql()<RunRow[]>`
    update process_transfer.runs
    set status = ${status}, completed_at = coalesce(completed_at, now()),
      error = coalesce(error, ${reason}),
      stages = coalesce((
        select jsonb_agg(
          case
            when stage ->> 'status' = 'running' then stage
              || jsonb_build_object('status', 'failed', 'summary', ${reason}::text)
            when stage ->> 'status' = 'pending' then stage
              || '{"status": "skipped"}'::jsonb
            else stage end
          order by position)
        from jsonb_array_elements(stages) with ordinality as s(stage, position)
      ), stages)
    where id = ${id} and owner = ${owner} and status in ('queued', 'running')
    returning *`;
  return row ?? null;
}

/**
 * Puts a finished Run back to Design for a Redo, under new Rules and models.
 * Only a Run whose Process was verified qualifies. Returns the new
 * generation (the Run's `redos`), or null when the Run did not qualify.
 */
export async function resetForRedo(input: {
  id: string;
  owner: Owner;
  stages: StageState[];
  rules: Rule[];
  rulesVersion: number;
  models: ModelChoice;
}): Promise<number | null> {
  const rows = await sql()<{ redos: number }[]>`
    update process_transfer.runs
    set status = 'queued', rounds = '[]'::jsonb, approval = null,
      completed_at = null, error = null, workflow_run_id = null,
      stages = ${json(input.stages)}, rules = ${json(input.rules)},
      rules_version = ${input.rulesVersion}, models = ${json(input.models)},
      redos = redos + 1, started_at = now()
    where id = ${input.id} and owner = ${input.owner}
      and status in ('completed', 'failed', 'stopped')
      and process is not null
      and exists (
        select 1 from jsonb_array_elements(stages) as s(stage)
        where stage ->> 'id' = 'verify' and stage ->> 'status' = 'done'
      )
    returning redos`;
  return rows[0]?.redos ?? null;
}

export async function appendLogs(
  id: string,
  generation: number,
  logs: RunLog[],
) {
  if (logs.length === 0) return;
  await sql()`
    update process_transfer.runs
    set logs = (
      select coalesce(jsonb_agg(entry order by position), '[]'::jsonb)
      from jsonb_array_elements(logs || ${json(logs)}) with ordinality as t(entry, position)
      where position > jsonb_array_length(logs || ${json(logs)}) - ${MAX_LOGS}
    )
    where id = ${id} and redos = ${generation}`;
}

// Model calls --------------------------------------------------------------------

/**
 * Records a call and adds its cost to the Run, whatever state the Run is in:
 * a call that returns after a Stop or a Redo was still paid for. Returns the
 * Run's new total.
 */
export async function recordModelCall(
  runId: string,
  call: Omit<ModelCall, "id" | "at">,
): Promise<{ call: ModelCall; runCostUsd: number }> {
  const [row] = await sql()<{ id: string; created_at: Date }[]>`
    insert into process_transfer.model_calls
      (run_id, purpose, label, model, input_tokens, output_tokens, cost_usd, ms, generation)
    values (${runId}, ${call.purpose}, ${call.label}, ${call.model},
      ${call.inputTokens}, ${call.outputTokens}, ${call.costUsd}, ${call.ms},
      ${call.generation ?? 0})
    returning id, created_at`;
  const [run] = await sql()<{ cost_usd: string }[]>`
    update process_transfer.runs set cost_usd = cost_usd + ${call.costUsd}
    where id = ${runId}
    returning cost_usd`;
  return {
    call: { ...call, id: row.id, at: row.created_at.toISOString() },
    runCostUsd: Number(run?.cost_usd ?? 0),
  };
}

export async function modelCalls(runId: string): Promise<ModelCall[]> {
  const rows = await sql()<
    {
      id: string;
      purpose: Purpose;
      label: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: string;
      ms: number;
      generation: number;
      created_at: Date;
    }[]
  >`
    select * from process_transfer.model_calls
    where run_id = ${runId} order by created_at, id`;
  return rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    label: row.label,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: Number(row.cost_usd),
    ms: row.ms,
    generation: row.generation,
    at: row.created_at.toISOString(),
  }));
}

/** USD the Owner's model calls cost in the last day, Redos included. */
export async function ownerSpentToday(owner: Owner): Promise<number> {
  const [row] = await sql()<{ total: string | null }[]>`
    select sum(c.cost_usd) as total
    from process_transfer.model_calls c
    join process_transfer.runs r on r.id = c.run_id
    where r.owner = ${owner} and c.created_at > now() - interval '1 day'`;
  return Number(row?.total ?? 0);
}

/** Runs and Redos started since a time, by one visitor or by everyone. */
export async function startsSince(
  since: Date,
  visitorHash?: string,
): Promise<number> {
  const [row] = await sql()<{ count: number }[]>`
    select count(*)::int as count
    from process_transfer.audit_events
    where action in ('run.started', 'deck.redone')
      and created_at > ${since}
      ${visitorHash ? sql()`and visitor_hash = ${visitorHash}` : sql()``}`;
  return row?.count ?? 0;
}

// Settings ---------------------------------------------------------------------

export type SettingsRow = {
  owner: string;
  rule_overrides: unknown;
  models: unknown;
  version: number;
};

export async function settingsOf(owner: Owner): Promise<SettingsRow | null> {
  const [row] = await sql()<SettingsRow[]>`
    select owner, rule_overrides, models, version
    from process_transfer.settings where owner = ${owner}`;
  return row ?? null;
}

/** Saves an Owner's settings and bumps their version. */
export async function saveSettings(
  owner: Owner,
  input: { ruleOverrides?: unknown; models?: unknown },
): Promise<SettingsRow> {
  const overrides =
    input.ruleOverrides === undefined ? null : json(input.ruleOverrides);
  const models = input.models === undefined ? null : json(input.models);
  const [row] = await sql()<SettingsRow[]>`
    insert into process_transfer.settings (owner, rule_overrides, models, version)
    values (${owner}, coalesce(${overrides}::jsonb, '{}'::jsonb),
      coalesce(${models}::jsonb, '{}'::jsonb), 1)
    on conflict (owner) do update set
      rule_overrides = coalesce(${overrides}::jsonb, process_transfer.settings.rule_overrides),
      models = coalesce(${models}::jsonb, process_transfer.settings.models),
      version = process_transfer.settings.version + 1,
      updated_at = now()
    returning owner, rule_overrides, models, version`;
  return row;
}

/**
 * Changes an Owner's Rule overrides in one transaction, with the row locked:
 * two Rules saved at the same moment each see the other's change instead of
 * the later one writing the whole map back without it.
 */
export async function editRuleOverrides(
  owner: Owner,
  edit: (current: unknown) => unknown,
): Promise<{ before: SettingsRow; after: SettingsRow }> {
  return sql().begin(async (tx) => {
    await tx`
      insert into process_transfer.settings (owner, rule_overrides, models, version)
      values (${owner}, '{}'::jsonb, '{}'::jsonb, 0)
      on conflict (owner) do nothing`;
    const [before] = await tx<SettingsRow[]>`
      select owner, rule_overrides, models, version
      from process_transfer.settings where owner = ${owner} for update`;
    const [after] = await tx<SettingsRow[]>`
      update process_transfer.settings set
        rule_overrides = ${json(edit(before.rule_overrides))}::jsonb,
        version = version + 1,
        updated_at = now()
      where owner = ${owner}
      returning owner, rule_overrides, models, version`;
    return { before, after };
  });
}

// Audit ------------------------------------------------------------------------

export async function insertAudit(input: {
  owner: string;
  actor: AuditEvent["actor"];
  action: AuditAction;
  runId: string | null;
  summary: string;
  detail?: Record<string, unknown>;
  visitorHash?: string | null;
}) {
  await sql()`
    insert into process_transfer.audit_events
      (owner, actor, action, run_id, summary, detail, visitor_hash)
    values (${input.owner}, ${input.actor}, ${input.action}, ${input.runId},
      ${input.summary.slice(0, 500)}, ${json(input.detail ?? {})},
      ${input.visitorHash ?? null})`;
}

export async function listAuditEvents(
  owner: Owner,
  options: { before?: number; runId?: string; limit: number },
): Promise<AuditEvent[]> {
  const rows = await sql()<
    {
      id: number;
      created_at: Date;
      actor: AuditEvent["actor"];
      action: AuditAction;
      run_id: string | null;
      summary: string;
      detail: Record<string, unknown>;
    }[]
  >`
    select id, created_at, actor, action, run_id, summary, detail
    from process_transfer.audit_events
    where owner = ${owner}
      ${options.before ? sql()`and id < ${options.before}` : sql()``}
      ${options.runId ? sql()`and run_id = ${options.runId}` : sql()``}
    order by id desc
    limit ${options.limit}`;
  return rows.map((row) => ({
    id: row.id,
    at: row.created_at.toISOString(),
    actor: row.actor,
    action: row.action,
    runId: row.run_id,
    summary: row.summary,
    detail: row.detail,
  }));
}
