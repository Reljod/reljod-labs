import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  DEFAULT_MODELS,
  DEFAULT_RULEBOOK,
  type DocumentSource,
  type ExtractedName,
  type ModelChoice,
  modelChoiceSchema,
  type Purpose,
  type Rulebook,
  type RulebookVersion,
  type RunEvent,
  type RunEventInput,
  type RunStatus,
  type RunSummary,
  rulebookSchema,
  type Score,
  type StopReason,
} from "../domain/contract";
import { sql } from "./db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

// Runs ------------------------------------------------------------------------------

export type RunRow = {
  id: string;
  owner: Owner;
  title: string;
  pages: number;
  source: DocumentSource;
  status: RunStatus;
  models: ModelChoice;
  rulebook_version: number;
  rulebook: Rulebook;
  workflow_run_id: string | null;
  cost_usd: string | number;
  names: ExtractedName[];
  score: Score | null;
  error: string | null;
  /** The Done gate's verdict at the end; null when ended outside the workflow. */
  gate_passed: boolean | null;
  /** Why the harness wound a completed Run up early, if it did. */
  stopped_by: StopReason | null;
  visitor_hash: string;
  started_at: string;
  ended_at: string | null;
};

export function isOver(status: RunStatus) {
  return status === "completed" || status === "failed" || status === "stopped";
}

export function toSummary(row: RunRow): RunSummary {
  const models = modelChoiceSchema.safeParse(row.models);
  return {
    id: row.id,
    title: row.title,
    pages: row.pages,
    source: row.source,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    models: models.success ? models.data : DEFAULT_MODELS,
    rulebookVersion: row.rulebook_version,
    costUsd: Number(row.cost_usd) || 0,
    names: Array.isArray(row.names) ? row.names.length : 0,
    score: row.score ?? null,
    gatePassed: row.gate_passed ?? null,
    stoppedBy: row.stopped_by ?? null,
  };
}

/**
 * Creates a Run row if the Owner and visitor are under their limits, under
 * one advisory lock (no race between the count and the insert). Null limits
 * skip the check (the e2e suite).
 */
export async function createRun(input: {
  owner: Owner;
  visitorHash: string;
  title: string;
  pages: number;
  source: DocumentSource;
  models: ModelChoice;
  rulebookVersion: number;
  rulebook: Rulebook;
  limits: {
    perOwnerPerDay: number;
    perVisitorPerHour: number;
    activePerOwner: number;
  } | null;
}): Promise<{ runId: string } | { refusal: string }> {
  const db = sql();
  const [row] = await db<{ run_id: string | null; refusal: string | null }[]>`
    select run_id, refusal from name_extraction.create_run(
      p_owner => ${input.owner}::text,
      p_visitor_hash => ${input.visitorHash}::text,
      p_title => ${input.title.slice(0, 200)}::text,
      p_pages => ${input.pages}::integer,
      p_source => ${db.json(input.source as never)}::jsonb,
      p_models => ${db.json(input.models as never)}::jsonb,
      p_rulebook_version => ${input.rulebookVersion}::integer,
      p_rulebook => ${db.json(input.rulebook as never)}::jsonb,
      p_per_owner_per_day => ${input.limits?.perOwnerPerDay ?? null}::integer,
      p_per_visitor_per_hour => ${input.limits?.perVisitorPerHour ?? null}::integer,
      p_active_per_owner => ${input.limits?.activePerOwner ?? null}::integer
    )
  `;
  if (row?.run_id) return { runId: row.run_id };
  return { refusal: row?.refusal ?? "The run could not be started." };
}

/** The columns a patch may set on a Run: a fixed list, so no other key reaches the SQL. */
const RUN_PATCH_COLUMNS = [
  "status",
  "workflow_run_id",
  "names",
  "score",
  "error",
  "ended_at",
  "cost_usd",
  "gate_passed",
  "stopped_by",
] as const;

type RunPatch = Partial<Pick<RunRow, (typeof RUN_PATCH_COLUMNS)[number]>>;

/**
 * A patch as column values for `set ${db(values)}`: only the allowlisted
 * columns, undefined keys dropped (as the Data API's JSON body dropped them),
 * and the jsonb columns sent as JSON (an array would otherwise go as a
 * Postgres array). A null stays SQL null, not JSON `null`.
 */
function runSetValues(patch: RunPatch) {
  const db = sql();
  const values: Record<string, unknown> = {};
  for (const column of RUN_PATCH_COLUMNS) {
    const value = patch[column];
    if (value === undefined) continue;
    values[column] =
      (column === "names" || column === "score") && value !== null
        ? db.json(value as never)
        : value;
  }
  return values;
}

export async function updateRun(
  runId: string,
  patch: Partial<
    Pick<
      RunRow,
      | "status"
      | "workflow_run_id"
      | "names"
      | "score"
      | "error"
      | "ended_at"
      | "cost_usd"
    >
  >,
) {
  const values = runSetValues(patch);
  if (Object.keys(values).length === 0) return;
  const db = sql();
  await db`
    update name_extraction.runs set ${db(values as never)}
    where id = ${runId}
  `;
}

/**
 * Ends a Run that is still going, and only then: a Run that already ended
 * keeps its status (a late "stopped" never overwrites "completed"). True when
 * this call ended it, so only that caller writes the `end` event.
 */
export async function endRunIfGoing(
  runId: string,
  patch: Partial<
    Pick<
      RunRow,
      | "status"
      | "error"
      | "names"
      | "score"
      | "cost_usd"
      | "gate_passed"
      | "stopped_by"
    >
  >,
): Promise<boolean> {
  const db = sql();
  const values = runSetValues({
    ...patch,
    ended_at: new Date().toISOString(),
  });
  const ended = await db<{ id: string }[]>`
    update name_extraction.runs set ${db(values as never)}
    where id = ${runId} and status in ('queued', 'running')
    returning id
  `;
  return ended.length > 0;
}

/** A Run by id, with no Owner check: for the workflow and the stream only. */
export async function getRunRow(runId: string): Promise<RunRow | null> {
  if (!isUuid(runId)) return null;
  const [run] = await sql()<RunRow[]>`
    select * from name_extraction.runs where id = ${runId} limit 1
  `;
  return run ?? null;
}

/** A Run, if the Owner owns it. */
export async function ownedRun(
  owner: Owner,
  runId: string,
): Promise<RunRow | null> {
  if (!isUuid(runId)) return null;
  const [run] = await sql()<RunRow[]>`
    select * from name_extraction.runs
    where id = ${runId} and owner = ${owner}
    limit 1
  `;
  return run ?? null;
}

export async function runsOf(owner: Owner, limit = 50): Promise<RunRow[]> {
  return [
    ...(await sql()<RunRow[]>`
      select * from name_extraction.runs
      where owner = ${owner}
      order by started_at desc
      limit ${limit}
    `),
  ];
}

/** Whether a Run was stopped: the workflow checks it between turns. */
export async function runStatus(runId: string): Promise<RunStatus | null> {
  const [row] = await sql()<{ status: RunStatus }[]>`
    select status from name_extraction.runs where id = ${runId} limit 1
  `;
  return row?.status ?? null;
}

// Events (the Audit trail) ------------------------------------------------------------

export type StoredEvent = RunEvent & { seq: number };

type EventRow = {
  seq: number | string;
  at: string;
  type: string;
  payload: Record<string, unknown>;
};

const toEvent = (row: EventRow): StoredEvent =>
  ({
    ...row.payload,
    type: row.type,
    at: Date.parse(row.at),
    seq: Number(row.seq),
  }) as StoredEvent;

/** Appends events in order. The trail is append-only: never updated or deleted. */
export async function insertEvents(
  runId: string,
  events: (RunEventInput & { at?: number })[],
) {
  if (events.length === 0) return;
  const db = sql();
  // One multi-row insert: the rows take their seqs in this order.
  const values = events.map(({ type, at, ...payload }) => ({
    run_id: runId,
    type,
    at: new Date(at ?? Date.now()).toISOString(),
    payload: db.json(payload as never),
  }));
  await db`
    insert into name_extraction.run_events
    ${db(values as never, "run_id", "type", "at", "payload")}
  `;
}

/** A Run's events after a cursor, in order. */
export async function eventsAfter(
  runId: string,
  afterSeq: number,
  limit = 500,
): Promise<StoredEvent[]> {
  const page = await sql()<EventRow[]>`
    select seq, at, type, payload from name_extraction.run_events
    where run_id = ${runId} and seq > ${afterSeq}
    order by seq asc
    limit ${limit}
  `;
  return page.map(toEvent);
}

/** Every event of a Run, in pages of 1000 (keeps each read bounded). */
export async function allEvents(runId: string, max = 20_000) {
  const events: StoredEvent[] = [];
  let after = 0;
  while (events.length < max) {
    const page = await eventsAfter(runId, after, 1000);
    events.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].seq;
  }
  return events;
}

/** The Register in a Run's latest `names` event, or null when it has none yet. */
export async function latestNames(
  runId: string,
): Promise<ExtractedName[] | null> {
  const [row] = await sql()<EventRow[]>`
    select seq, at, type, payload from name_extraction.run_events
    where run_id = ${runId} and type = 'names'
    order by seq desc
    limit 1
  `;
  if (!row) return null;
  const event = toEvent(row);
  return event.type === "names" && Array.isArray(event.names)
    ? event.names
    : null;
}

// Model calls ---------------------------------------------------------------------------

export async function recordModelCall(input: {
  runId: string;
  purpose: Purpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
}) {
  await sql()`
    insert into name_extraction.model_calls (
      run_id, purpose, model, input_tokens, output_tokens,
      cached_input_tokens, cost_usd, latency_ms
    ) values (
      ${input.runId},
      ${input.purpose},
      ${input.model},
      ${Math.max(0, Math.round(input.inputTokens))},
      ${Math.max(0, Math.round(input.outputTokens))},
      ${Math.max(0, Math.round(input.cachedInputTokens))},
      ${Math.max(0, input.costUsd)},
      ${Math.max(0, Math.round(input.latencyMs))}
    )
  `;
}

/** What a Run's model calls cost so far, in USD. */
export async function runSpend(runId: string) {
  const calls = await sql()<{ cost_usd: string | number }[]>`
    select cost_usd from name_extraction.model_calls where run_id = ${runId}
  `;
  return calls.reduce((sum, call) => sum + (Number(call.cost_usd) || 0), 0);
}

// Rulebooks -------------------------------------------------------------------------------

type RulebookRow = {
  version: number;
  rulebook: unknown;
  note: string | null;
  created_at: string;
};

export const DEFAULT_VERSION: RulebookVersion = {
  version: 0,
  rulebook: DEFAULT_RULEBOOK,
  createdAt: new Date(0).toISOString(),
  note: null,
};

function toVersion(row: RulebookRow): RulebookVersion | null {
  const parsed = rulebookSchema.safeParse(row.rulebook);
  if (!parsed.success) return null;
  return {
    version: row.version,
    rulebook: parsed.data,
    createdAt: row.created_at,
    note: row.note,
  };
}

/** The Owner's current Rulebook: their latest version, or the default (version 0). */
export async function currentRulebook(owner: Owner): Promise<RulebookVersion> {
  const [row] = await sql()<RulebookRow[]>`
    select version, rulebook, note, created_at from name_extraction.rulebooks
    where owner = ${owner}
    order by version desc
    limit 1
  `;
  return (row && toVersion(row)) ?? DEFAULT_VERSION;
}

/** Every version the Owner saved, newest first, then the default. */
export async function rulebookVersions(
  owner: Owner,
  limit = 100,
): Promise<RulebookVersion[]> {
  const saved = await sql()<RulebookRow[]>`
    select version, rulebook, note, created_at from name_extraction.rulebooks
    where owner = ${owner}
    order by version desc
    limit ${limit}
  `;
  return [...saved.flatMap((row) => toVersion(row) ?? []), DEFAULT_VERSION];
}

/**
 * Saves the Owner's next Rulebook version if they are under the daily cap,
 * counted and inserted under one advisory lock. A null cap skips the check
 * (the e2e suite).
 */
export async function insertRulebook(
  owner: Owner,
  rulebook: Rulebook,
  note: string | null,
  perOwnerPerDay: number | null,
): Promise<{ version: number } | { refusal: string }> {
  const db = sql();
  const [row] = await db<{ version: number | null; refusal: string | null }[]>`
    select version, refusal from name_extraction.save_rulebook(
      p_owner => ${owner}::text,
      p_rulebook => ${db.json(rulebook as never)}::jsonb,
      p_note => ${note}::text,
      p_per_owner_per_day => ${perOwnerPerDay}::integer
    )
  `;
  if (row?.version) return { version: row.version };
  return { refusal: row?.refusal ?? "The Rulebook could not be saved." };
}

// Uploads -----------------------------------------------------------------------------------

export type UploadRow = {
  id: string;
  owner: Owner;
  title: string;
  pages: number;
  storage_path: string;
  created_at: string;
};

export async function insertUpload(input: {
  id: string;
  owner: Owner;
  title: string;
  pages: number;
  storagePath: string;
}) {
  await sql()`
    insert into name_extraction.uploads (id, owner, title, pages, storage_path)
    values (
      ${input.id}, ${input.owner}, ${input.title}, ${input.pages},
      ${input.storagePath}
    )
  `;
}

export async function ownedUpload(
  owner: Owner,
  uploadId: string,
): Promise<UploadRow | null> {
  if (!isUuid(uploadId)) return null;
  const [row] = await sql()<UploadRow[]>`
    select * from name_extraction.uploads
    where id = ${uploadId} and owner = ${owner}
    limit 1
  `;
  return row ?? null;
}

/** An Upload by id with no Owner check: for the workflow, which got the id from an owned Run. */
export async function getUpload(uploadId: string): Promise<UploadRow | null> {
  if (!isUuid(uploadId)) return null;
  const [row] = await sql()<UploadRow[]>`
    select * from name_extraction.uploads where id = ${uploadId} limit 1
  `;
  return row ?? null;
}

export async function countUploadsSince(owner: Owner, since: Date) {
  const [row] = await sql()<{ count: number }[]>`
    select count(*)::int as count from name_extraction.uploads
    where owner = ${owner} and created_at >= ${since.toISOString()}::timestamptz
  `;
  return row?.count ?? 0;
}
