import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Finding, Verdict } from "../domain/checks";
import {
  type Driver,
  EMPTY_METRICS,
  isOver,
  type ManifestSummary,
  type ModelId,
  type PendingApproval,
  type RulebookVersion,
  type RunEvent,
  type RunEventInput,
  type RunMetrics,
  type RunStatus,
  type RunSummary,
  type StopReason,
} from "../domain/contract";
import { STALE_RUN_MINUTES } from "../domain/limits";
import type { ManifestRow } from "../domain/manifest";
import {
  DEFAULT_RULEBOOK,
  type Rulebook,
  rulebookSchema,
} from "../domain/rules";
import { type Db, isUuid, jsonb, sql } from "./db";

/*
 * Every read and write of the `operator` schema. Each function that touches
 * an Owner's data takes the Owner and filters by it (ADR 0011); the ones that
 * take only a run id are for the workflow, which was handed that id by a
 * function that already checked the Owner.
 */

// Rulebooks -------------------------------------------------------------------------------

/** A stored Rulebook, read back through the schema; anything that no longer fits falls to the Default. */
function asRulebook(value: unknown): Rulebook {
  const parsed = rulebookSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_RULEBOOK;
}

export async function currentRulebook(
  owner: Owner,
): Promise<{ version: number; rulebook: Rulebook }> {
  const [row] = await sql()<{ version: number; rulebook: unknown }[]>`
    select version, rulebook from operator.rulebooks
    where owner = ${owner} order by version desc limit 1`;
  return row
    ? { version: row.version, rulebook: asRulebook(row.rulebook) }
    : { version: 0, rulebook: DEFAULT_RULEBOOK };
}

/** Every version, newest first, then the Default. The first is the current one. */
export async function rulebookVersions(
  owner: Owner,
): Promise<RulebookVersion[]> {
  const rows = await sql()<
    {
      version: number;
      rulebook: unknown;
      note: string | null;
      created_at: Date;
    }[]
  >`
    select version, rulebook, note, created_at from operator.rulebooks
    where owner = ${owner} order by version desc limit 100`;
  return [
    ...rows.map((row) => ({
      version: row.version,
      rulebook: asRulebook(row.rulebook),
      note: row.note,
      createdAt: row.created_at.toISOString(),
    })),
    {
      version: 0,
      rulebook: DEFAULT_RULEBOOK,
      note: "Default",
      createdAt: null,
    },
  ];
}

/** Saves the next version, counted and inserted under one lock. A null cap skips the count. */
export async function insertRulebook(
  owner: Owner,
  rulebook: Rulebook,
  note: string | null,
  dailyCap: number | null,
): Promise<{ version: number } | { refusal: string }> {
  return sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`operator-rulebook:${owner}`}))`;
    if (dailyCap !== null) {
      const [{ count }] = await tx<{ count: number }[]>`
        select count(*)::int as count from operator.rulebooks
        where owner = ${owner} and created_at > now() - interval '1 day'`;
      if (count >= dailyCap)
        return {
          refusal: `That's ${dailyCap} Rulebook versions today. Try again tomorrow.`,
        };
    }
    const [row] = await tx<{ version: number }[]>`
      insert into operator.rulebooks (owner, version, rulebook, note)
      select ${owner}, coalesce(max(version), 0) + 1, ${jsonb(tx, rulebook)}, ${note}
      from operator.rulebooks where owner = ${owner}
      returning version`;
    return { version: row.version };
  });
}

// Manifests -------------------------------------------------------------------------------

export type ManifestParsed = {
  vessel?: string;
  voyage?: string;
  lines: ManifestRow[];
  problems: string[];
};

export type ManifestRecord = {
  id: string;
  owner: string;
  name: string;
  kind: "csv" | "pdf";
  storage_path: string;
  status: "pending" | "read" | "failed";
  body: string | null;
  parsed: ManifestParsed | null;
};

export async function countManifestsSince(owner: Owner, since: Date) {
  const [{ count }] = await sql()<{ count: number }[]>`
    select count(*)::int as count from operator.manifests
    where owner = ${owner} and created_at > ${since}`;
  return count;
}

export async function insertManifest(input: {
  id: string;
  owner: Owner;
  name: string;
  kind: "csv" | "pdf";
  storagePath: string;
}) {
  await sql()`
    insert into operator.manifests (id, owner, name, kind, storage_path)
    values (${input.id}, ${input.owner}, ${input.name}, ${input.kind}, ${input.storagePath})`;
}

export async function ownedManifest(
  owner: Owner,
  id: string,
): Promise<ManifestRecord | null> {
  if (!isUuid(id)) return null;
  const [row] = await sql()<ManifestRecord[]>`
    select id, owner, name, kind, storage_path, status, body, parsed
    from operator.manifests where id = ${id} and owner = ${owner}`;
  return row ?? null;
}

export async function saveManifestRead(
  id: string,
  body: string,
  parsed: ManifestParsed,
) {
  const db = sql();
  await db`
    update operator.manifests
    set status = 'read', body = ${body}, parsed = ${jsonb(db, parsed)}
    where id = ${id}`;
}

export async function failManifest(id: string) {
  await sql()`update operator.manifests set status = 'failed' where id = ${id}`;
}

export function manifestSummary(row: ManifestRecord): ManifestSummary {
  return {
    id: row.id,
    name: row.name,
    rows: row.parsed?.lines.length ?? 0,
    vessel: row.parsed?.vessel ?? null,
    voyage: row.parsed?.voyage ?? null,
    problems: row.parsed?.problems ?? [],
  };
}

export async function manifestsOf(owner: Owner): Promise<ManifestSummary[]> {
  const rows = await sql()<ManifestRecord[]>`
    select id, owner, name, kind, storage_path, status, body, parsed
    from operator.manifests
    where owner = ${owner} and status = 'read'
    order by created_at desc limit 30`;
  return rows.map(manifestSummary);
}

// Runs ------------------------------------------------------------------------------------

export type RunRow = {
  id: string;
  owner: string;
  visitor_hash: string;
  driver: Driver;
  task_id: string | null;
  title: string;
  brief: string;
  manifest_id: string | null;
  manifest_name: string | null;
  model: ModelId | null;
  rulebook_version: number;
  rulebook: unknown;
  stubbed: boolean;
  status: RunStatus;
  stopped_by: StopReason | null;
  verdict: Verdict | null;
  findings: Finding[];
  metrics: Partial<RunMetrics>;
  cost_usd: string | number;
  error: string | null;
  summary: string | null;
  workflow_run_id: string | null;
  screen_secret: string | null;
  started_at: Date;
  ended_at: Date | null;
  /** The pending Approval, when the query joined it. */
  pending?: PendingApproval | null;
};

const RUN_COLUMNS = (db: Db) => db`
  r.id, r.owner, r.visitor_hash, r.driver, r.task_id, r.title, r.brief,
  r.manifest_id, r.manifest_name, r.model, r.rulebook_version, r.rulebook,
  r.stubbed, r.status, r.stopped_by, r.verdict, r.findings, r.metrics,
  r.cost_usd, r.error, r.summary, r.workflow_run_id, r.screen_secret,
  r.started_at, r.ended_at,
  (select a.pending from operator.approvals a
    where a.run_id = r.id and a.status = 'pending'
    order by a.created_at desc limit 1) as pending`;

export type RunLimits = {
  perVisitorPerHour: number;
  perOwnerPerDay: number;
  activePerOwner: number;
};

/**
 * Inserts a Run under the limits, counted and inserted under one lock per
 * Owner so two starts cannot both pass the count. Null limits (the e2e
 * bypass) skip the counts but not the one-live-Screen rule's lock.
 */
export async function createRun(input: {
  owner: Owner;
  visitorHash: string;
  driver: Driver;
  taskId: string | null;
  title: string;
  brief: string;
  manifestId: string | null;
  manifestName: string | null;
  model: ModelId | null;
  rulebookVersion: number;
  rulebook: Rulebook;
  stubbed: boolean;
  screenSecret: string | null;
  /** A hand Run is over when it is filed. */
  finished?: {
    verdict: Verdict;
    findings: Finding[];
    metrics: RunMetrics;
  };
  limits: RunLimits | null;
}): Promise<{ runId: string } | { refusal: string }> {
  return sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`operator-run:${input.owner}`}))`;
    const live = input.driver !== "hand";
    if (input.limits) {
      const [counts] = await tx<
        { hour: number; day: number; active: number }[]
      >`
        select
          (select count(*)::int from operator.runs
            where visitor_hash = ${input.visitorHash} and (driver = 'hand') = ${!live}
              and started_at > now() - interval '1 hour') as hour,
          (select count(*)::int from operator.runs
            where owner = ${input.owner} and driver <> 'hand'
              and started_at > now() - interval '1 day') as day,
          (select count(*)::int from operator.runs
            where owner = ${input.owner} and driver <> 'hand'
              and status in ('queued', 'running', 'paused')
              and started_at > now() - make_interval(mins => ${STALE_RUN_MINUTES})) as active`;
      if (counts.hour >= input.limits.perVisitorPerHour)
        return {
          refusal: `That's ${input.limits.perVisitorPerHour} in the last hour. Try again later.`,
        };
      if (live && counts.day >= input.limits.perOwnerPerDay)
        return {
          refusal: `That's ${input.limits.perOwnerPerDay} Runs today. Try again tomorrow.`,
        };
      if (live && counts.active >= input.limits.activePerOwner)
        return {
          refusal:
            "A Run is already going. Watch it finish or stop it, then start another.",
        };
    }
    const done = input.finished;
    const [row] = await tx<{ id: string }[]>`
      insert into operator.runs (
        owner, visitor_hash, driver, task_id, title, brief, manifest_id,
        manifest_name, model, rulebook_version, rulebook, stubbed,
        screen_secret, status, verdict, findings, metrics, ended_at
      ) values (
        ${input.owner}, ${input.visitorHash}, ${input.driver}, ${input.taskId},
        ${input.title}, ${input.brief}, ${input.manifestId},
        ${input.manifestName}, ${input.model}, ${input.rulebookVersion},
        ${jsonb(tx, input.rulebook)}, ${input.stubbed}, ${input.screenSecret},
        ${done ? "completed" : "queued"}, ${done?.verdict ?? null},
        ${jsonb(tx, done?.findings ?? [])}, ${jsonb(tx, done?.metrics ?? {})},
        ${done ? tx`now()` : null}
      ) returning id`;
    return { runId: row.id };
  });
}

export async function ownedRun(
  owner: Owner,
  runId: string,
): Promise<RunRow | null> {
  if (!isUuid(runId)) return null;
  const db = sql();
  const [row] = await db<RunRow[]>`
    select ${RUN_COLUMNS(db)} from operator.runs r
    where r.id = ${runId} and r.owner = ${owner}`;
  return row ?? null;
}

/** For the workflow and the stream, which hold a run id a checked function gave them. */
export async function getRunRow(runId: string): Promise<RunRow | null> {
  if (!isUuid(runId)) return null;
  const db = sql();
  const [row] = await db<RunRow[]>`
    select ${RUN_COLUMNS(db)} from operator.runs r where r.id = ${runId}`;
  return row ?? null;
}

export async function runStatus(runId: string): Promise<RunStatus | null> {
  const [row] = await sql()<{ status: RunStatus }[]>`
    select status from operator.runs where id = ${runId}`;
  return row?.status ?? null;
}

export async function runsOf(owner: Owner, limit: number): Promise<RunRow[]> {
  const db = sql();
  return db<RunRow[]>`
    select ${RUN_COLUMNS(db)} from operator.runs r
    where r.owner = ${owner} order by r.started_at desc limit ${limit}`;
}

type RunPatch = Partial<{
  status: RunStatus;
  stopped_by: StopReason;
  verdict: Verdict;
  findings: Finding[];
  metrics: RunMetrics;
  cost_usd: number;
  error: string;
  summary: string;
  workflow_run_id: string;
}>;

function patchColumns(db: Db, patch: RunPatch) {
  const { findings, metrics, ...plain } = patch;
  const values: Record<string, unknown> = { ...plain };
  if (findings !== undefined) values.findings = jsonb(db, findings);
  if (metrics !== undefined) values.metrics = jsonb(db, metrics);
  return values;
}

/** Updates a Run that is still going. A Run that ended keeps what it ended with. */
export async function updateRun(runId: string, patch: RunPatch) {
  const db = sql();
  const values = patchColumns(db, patch);
  if (Object.keys(values).length === 0) return;
  await db`
    update operator.runs set ${db(values as never)}
    where id = ${runId} and status in ('queued', 'running', 'paused')`;
}

/** The workflow's id, written whatever the status: stop needs it even on a Run that just ended. */
export async function setWorkflowRun(runId: string, workflowRunId: string) {
  await sql()`
    update operator.runs set workflow_run_id = ${workflowRunId} where id = ${runId}`;
}

/**
 * Moves a Run between two going states (running and paused). False when the
 * Run is not in `from` any more: it ended, and whoever asked must not act.
 */
export async function moveRun(
  runId: string,
  from: RunStatus[],
  to: "running" | "paused",
): Promise<boolean> {
  const rows = await sql()`
    update operator.runs set status = ${to}
    where id = ${runId} and status in ${sql()(from)} returning id`;
  return rows.length > 0;
}

/**
 * Ends a Run still going; a Run already ended keeps its status. True only for
 * the call that ended it.
 */
export async function endRunIfGoing(
  runId: string,
  patch: RunPatch & { status: "completed" | "failed" | "stopped" },
): Promise<boolean> {
  const db = sql();
  const rows = await db`
    update operator.runs set ${db(patchColumns(db, patch) as never)}, ended_at = now()
    where id = ${runId} and status in ('queued', 'running', 'paused')
    returning id`;
  return rows.length > 0;
}

export function metricsOf(row: Pick<RunRow, "metrics">): RunMetrics {
  return { ...EMPTY_METRICS, ...(row.metrics ?? {}) };
}

export function toSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    driver: row.driver,
    taskId: row.task_id,
    title: row.title,
    brief: row.brief,
    manifestName: row.manifest_name,
    model: row.model,
    status: row.status,
    stoppedBy: row.stopped_by,
    verdict: row.verdict,
    error: row.error,
    costUsd: Number(row.cost_usd),
    metrics: metricsOf(row),
    rulebookVersion: row.rulebook_version,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    pending: isOver(row.status) ? null : (row.pending ?? null),
  };
}

export const runRulebook = (row: Pick<RunRow, "rulebook">) =>
  asRulebook(row.rulebook);

// Events: the Trail -----------------------------------------------------------------------

type EventRow = { seq: number; at: Date; data: RunEventInput };

const toEvent = (row: EventRow): RunEvent =>
  ({ ...row.data, seq: row.seq, at: row.at.getTime() }) as RunEvent;

/** Appends events in order. Each is one row; the Trail is never edited. */
export async function insertEvents(runId: string, events: RunEventInput[]) {
  if (events.length === 0) return;
  const db = sql();
  const rows = events.map((event) => ({
    run_id: runId,
    type: event.type,
    data: jsonb(db, event),
  }));
  await db`insert into operator.run_events ${db(rows as never)}`;
}

export async function eventsAfter(
  runId: string,
  after: number,
  limit: number,
): Promise<RunEvent[]> {
  const rows = await sql()<EventRow[]>`
    select seq, at, data from operator.run_events
    where run_id = ${runId} and seq > ${after}
    order by seq asc limit ${limit}`;
  return rows.map(toEvent);
}

export async function allEvents(runId: string): Promise<RunEvent[]> {
  return eventsAfter(runId, 0, 5000);
}

// Approvals -------------------------------------------------------------------------------

export type ApprovalRow = {
  id: string;
  run_id: string;
  fingerprint: string;
  pending: PendingApproval;
  status: "pending" | "approved" | "refused" | "expired";
  hook_token: string | null;
};

export async function insertApproval(input: {
  id: string;
  runId: string;
  fingerprint: string;
  pending: PendingApproval;
  hookToken: string | null;
}) {
  const db = sql();
  await db`
    insert into operator.approvals (id, run_id, fingerprint, pending, hook_token)
    values (${input.id}, ${input.runId}, ${input.fingerprint},
      ${jsonb(db, input.pending)}, ${input.hookToken})`;
}

/**
 * Decides an Approval that is still pending. Null when it was already decided
 * (a second click, or the harness expired it first): the first decision stands.
 */
export async function decideApprovalRow(
  runId: string,
  approvalId: string,
  status: "approved" | "refused" | "expired",
): Promise<ApprovalRow | null> {
  if (!isUuid(approvalId)) return null;
  const [row] = await sql()<ApprovalRow[]>`
    update operator.approvals set status = ${status}, decided_at = now()
    where id = ${approvalId} and run_id = ${runId} and status = 'pending'
    returning id, run_id, fingerprint, pending, status, hook_token`;
  return row ?? null;
}

export async function approvalRow(
  runId: string,
  approvalId: string,
): Promise<ApprovalRow | null> {
  if (!isUuid(approvalId)) return null;
  const [row] = await sql()<ApprovalRow[]>`
    select id, run_id, fingerprint, pending, status, hook_token
    from operator.approvals where id = ${approvalId} and run_id = ${runId}`;
  return row ?? null;
}

/** Fingerprints a person approved in a Run, for the checks at the end. */
export async function approvedFingerprints(runId: string): Promise<string[]> {
  const rows = await sql()<{ fingerprint: string }[]>`
    select fingerprint from operator.approvals
    where run_id = ${runId} and status = 'approved' order by created_at`;
  return rows.map((row) => row.fingerprint);
}

/** Expires whatever is still pending when a Run ends, so nothing waits on a dead Run. */
export async function expirePending(runId: string) {
  await sql()`
    update operator.approvals set status = 'expired', decided_at = now()
    where run_id = ${runId} and status = 'pending'`;
}
