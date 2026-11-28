import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { jsonb, db as sql } from "@/server/postgres";
import type { Scenario } from "../domain/case-file";
import type { JobId } from "../domain/jobs";
import type { ModelSettings, Purpose } from "../domain/model-config";
import type { PipelineId } from "../domain/pipelines";
import type { Answer } from "../domain/run-events";
import type { RunDocument, RunState, SourceFormat } from "../domain/run-state";

/** The one row an `insert ... returning` gives back. */
function one<T>(found: readonly T[]): T {
  const [row] = found;
  if (row === undefined) throw new Error("Query returned no data");
  return row;
}

/** A nullable `jsonb` value: SQL null for null, the JSON otherwise. */
function jsonbOrNull(value: unknown) {
  return value === null || value === undefined ? null : jsonb(sql(), value);
}

// Sessions ---------------------------------------------------------------------

export type SessionRow = {
  id: string;
  visitor_hash: string;
  /** Null for Desks from before Owners, and for the outside MCP client's desk. */
  owner: Owner | null;
  model_overrides: Partial<Record<Purpose, Partial<ModelSettings>>>;
  title: string | null;
  created_at: string;
  last_active_at: string;
};

export async function createSession(visitorHash: string, owner: Owner | null) {
  return one(
    await sql()<{ id: string }[]>`
      insert into casework.sessions (visitor_hash, owner)
      values (${visitorHash}, ${owner})
      returning id`,
  ).id;
}

export async function getSession(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [session] = await sql()<SessionRow[]>`
    select * from casework.sessions where id = ${id} limit 1`;
  return session ?? null;
}

/** An Owner's Desks, newest activity first: the ones they can go back to. */
export async function sessionsOf(owner: Owner, limit: number) {
  return sql()<SessionRow[]>`
    select * from casework.sessions
    where owner = ${owner}
    order by last_active_at desc
    limit ${limit}`;
}

/**
 * The Desk a request works in, in one query: the Owner's Desk with the
 * browser's remembered id, else the Owner's latest. Null when they have none.
 * Never another Owner's: the id only breaks the tie among the Owner's own.
 */
export async function openSessionOf(owner: Owner, preferredId: string | null) {
  const preferred =
    preferredId && /^[0-9a-f-]{36}$/i.test(preferredId) ? preferredId : null;
  const [session] = await sql()<SessionRow[]>`
    select * from casework.sessions
    where owner = ${owner}
    order by (id = ${preferred}::uuid) is true desc, last_active_at desc
    limit 1`;
  return session ?? null;
}

/** An Owner's Desks, newest activity first, each with what it has spent, in one query. */
export async function sessionsWithSpend(owner: Owner, limit: number) {
  return sql()<(SessionRow & { spend_usd: number })[]>`
    select s.*, (
      select coalesce(sum(c.cost_usd), 0)::float8
      from casework.model_calls c where c.session_id = s.id
    ) as spend_usd
    from casework.sessions s
    where s.owner = ${owner}
    order by s.last_active_at desc
    limit ${limit}`;
}

/** Marks a desk as used now, and names it after its first request. */
export async function touchSession(session: SessionRow, title?: string) {
  const db = sql();
  const now = new Date().toISOString();
  await db`
    update casework.sessions
    set last_active_at = ${now}
      ${!session.title && title ? db`, title = ${title.slice(0, 80)}` : db``}
    where id = ${session.id}`;
}

export async function setModelOverrides(
  sessionId: string,
  overrides: SessionRow["model_overrides"],
) {
  const db = sql();
  await db`
    update casework.sessions
    set model_overrides = ${jsonb(db, overrides)}
    where id = ${sessionId}`;
}

export async function orgModelSettings() {
  const settings = await sql()<
    {
      purpose: Purpose;
      model: string;
      reasoning: ModelSettings["reasoning"];
      /** `numeric`: a string from Postgres. */
      temperature: string | number | null;
      max_output_tokens: number | null;
    }[]
  >`select * from casework.model_settings`;
  return Object.fromEntries(
    settings.map((row) => [
      row.purpose,
      {
        model: row.model,
        reasoning: row.reasoning,
        temperature: row.temperature === null ? null : Number(row.temperature),
        maxOutputTokens: row.max_output_tokens,
      },
    ]),
  ) as Partial<Record<Purpose, Partial<ModelSettings>>>;
}

// The Cabinet -------------------------------------------------------------------

export type DocumentRow = {
  id: string;
  case_file_slug: string | null;
  session_id: string | null;
  name: string;
  media_type: string;
  source_format: SourceFormat;
  storage_path: string;
  page_paths: string[];
  size_bytes: number;
  label_kind: string | null;
  /** Synthetic Documents only: the fields a correct Read returns. */
  label?: Record<string, unknown> | null;
  created_at: string;
};

export type CaseFileRow = {
  slug: string;
  scenario: Scenario;
  title: string;
  summary: string;
  as_of: string;
  split: "train" | "validation" | "test";
  position: number;
};

/** Every Document column but `label`; a fixed list, quoted as identifiers. */
const DOCUMENT_COLUMNS = [
  "id",
  "case_file_slug",
  "session_id",
  "name",
  "media_type",
  "source_format",
  "storage_path",
  "page_paths",
  "size_bytes",
  "label_kind",
  "created_at",
];
const LABELLED_DOCUMENT_COLUMNS = [...DOCUMENT_COLUMNS, "label"];

export async function loadCaseFiles() {
  return sql()<CaseFileRow[]>`
    select slug, scenario, title, summary, as_of, split, position
    from casework.case_files
    order by position`;
}

export async function loadCabinetDocuments(sessionId: string) {
  const db = sql();
  return db<DocumentRow[]>`
    select ${db(LABELLED_DOCUMENT_COLUMNS)} from casework.documents
    where case_file_slug is not null or session_id = ${sessionId}
    order by name`;
}

/** The Case files' synthetic Documents: shared seed data, the same for everyone. */
export async function loadSeedDocuments() {
  const db = sql();
  return db<DocumentRow[]>`
    select ${db(LABELLED_DOCUMENT_COLUMNS)} from casework.documents
    where case_file_slug is not null
    order by name`;
}

/** One desk's own uploads. */
export async function loadUploads(sessionId: string) {
  const db = sql();
  return db<DocumentRow[]>`
    select ${db(LABELLED_DOCUMENT_COLUMNS)} from casework.documents
    where session_id = ${sessionId}
    order by name`;
}

/** Documents by id that this session may use: the Cabinet's, or its own uploads. */
export async function documentsByIds(ids: string[], sessionId: string | null) {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return [];
  const db = sql();
  const found = await db<DocumentRow[]>`
    select ${db(DOCUMENT_COLUMNS)} from casework.documents
    where id = any(${valid}::uuid[])`;
  return found.filter(
    (document) => document.case_file_slug || document.session_id === sessionId,
  );
}

/**
 * Documents on file that could meet a Need: ones of a wanted Kind in the same
 * Case files as the Run's Documents, and this desk's uploads (whose Kind is
 * not known until sorted). Never ones already in the Run.
 */
export async function candidateDocuments(
  sessionId: string | null,
  runDocumentIds: string[],
  kinds: string[],
) {
  const inRun = await documentsByIds(runDocumentIds, sessionId);
  const slugs = [
    ...new Set(
      inRun.flatMap((row) => (row.case_file_slug ? [row.case_file_slug] : [])),
    ),
  ];
  const db = sql();
  const [filed, uploaded] = await Promise.all([
    slugs.length > 0 && kinds.length > 0
      ? db<DocumentRow[]>`
          select ${db(DOCUMENT_COLUMNS)} from casework.documents
          where case_file_slug = any(${slugs}::text[])
            and label_kind = any(${kinds}::text[])`
      : Promise.resolve([] as DocumentRow[]),
    sessionId
      ? db<DocumentRow[]>`
          select ${db(DOCUMENT_COLUMNS)} from casework.documents
          where session_id = ${sessionId}`
      : Promise.resolve([] as DocumentRow[]),
  ]);
  const taken = new Set(runDocumentIds);
  return [...filed, ...uploaded]
    .filter((row) => !taken.has(row.id))
    .slice(0, 6)
    .map((row) => ({ id: row.id, name: row.name }));
}

export function toRunDocument(row: DocumentRow): RunDocument {
  return {
    id: row.id,
    name: row.name,
    mediaType: row.media_type,
    sourceFormat: row.source_format,
    pageCount: Math.max(1, row.page_paths.length),
    storagePath: row.storage_path,
    pagePaths: row.page_paths,
  };
}

/** The review date for a set of Documents: their case files' date, or today. */
export async function asOfFor(documents: DocumentRow[]) {
  const slugs = [
    ...new Set(
      documents.flatMap((row) =>
        row.case_file_slug ? [row.case_file_slug] : [],
      ),
    ),
  ];
  if (slugs.length === 0) return new Date().toISOString().slice(0, 10);
  const dates = await sql()<{ as_of: string }[]>`
    select as_of from casework.case_files where slug = any(${slugs}::text[])`;
  return (
    dates
      .map((row) => row.as_of)
      .sort()
      .at(-1) ?? new Date().toISOString().slice(0, 10)
  );
}

export type NewUpload = {
  sessionId: string;
  name: string;
  mediaType: string;
  sourceFormat: SourceFormat;
  storagePath: string;
  pagePaths: string[];
  sizeBytes: number;
};

/**
 * Records uploads as Documents in one statement, in the order given. An
 * upload's path is recorded once (a unique index): a ticket used twice at the
 * same moment records nothing the second time, and is left out of the answer.
 */
export async function insertUploads(
  inputs: NewUpload[],
): Promise<DocumentRow[]> {
  if (inputs.length === 0) return [];
  const db = sql();
  const rows = inputs.map((input) => ({
    session_id: input.sessionId,
    name: input.name,
    media_type: input.mediaType,
    source_format: input.sourceFormat,
    storage_path: input.storagePath,
    page_paths: input.pagePaths,
    size_bytes: input.sizeBytes,
  }));
  const created = await db<DocumentRow[]>`
    insert into casework.documents ${db(rows)}
    on conflict do nothing
    returning ${db(DOCUMENT_COLUMNS)}`;
  const byPath = new Map(created.map((row) => [row.storage_path, row]));
  return inputs.flatMap((input) => byPath.get(input.storagePath) ?? []);
}

export async function insertUpload(
  input: NewUpload,
): Promise<DocumentRow | null> {
  return (await insertUploads([input]))[0] ?? null;
}

/** Which of these Storage paths are already recorded as uploads of the Desk. */
export async function recordedUploadPaths(
  sessionId: string,
  paths: string[],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const found = await sql()<{ storage_path: string }[]>`
    select storage_path from casework.documents
    where session_id = ${sessionId}::uuid
      and storage_path = any(${paths}::text[])`;
  return new Set(found.map((row) => row.storage_path));
}

export async function countUploads(sessionId: string) {
  const [row] = await sql()<{ count: number }[]>`
    select count(*)::int as count from casework.documents
    where session_id = ${sessionId}`;
  return row?.count ?? 0;
}

// Messages ------------------------------------------------------------------------

export type MessageRow = {
  id: number;
  session_id: string;
  role: "user" | "specialist";
  text: string;
  document_ids: string[];
  run_id: string | null;
  tool_calls: {
    name: string;
    input: unknown;
    output?: unknown;
    ok?: boolean;
    summary?: string;
  }[];
  created_at: string;
};

export async function addMessage(input: {
  sessionId: string;
  role: MessageRow["role"];
  text: string;
  documentIds?: string[];
  runId?: string | null;
  toolCalls?: MessageRow["tool_calls"];
}) {
  const db = sql();
  return one(
    await db<{ id: number }[]>`
      insert into casework.messages
        (session_id, role, text, document_ids, run_id, tool_calls)
      values (
        ${input.sessionId}, ${input.role}, ${input.text},
        ${input.documentIds ?? []}::uuid[], ${input.runId ?? null},
        ${jsonb(db, input.toolCalls ?? [])}
      )
      returning id`,
  ).id;
}

export async function loadMessages(sessionId: string, limit = 40) {
  const recent = await sql()<MessageRow[]>`
    select * from casework.messages
    where session_id = ${sessionId}
    order by id desc
    limit ${limit}`;
  return [...recent].reverse();
}

// Runs ----------------------------------------------------------------------------

export type RunRow = {
  id: string;
  session_id: string | null;
  pipeline: PipelineId | null;
  jobs: JobId[];
  document_ids: string[];
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "stopped";
  workflow_run_id: string | null;
  state: RunState | null;
  recommendation: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

/** Why a Run was not created: the Desk has one going, or a rate limit. */
export type RunRefusal =
  | "active"
  | "visitor"
  | "day"
  | "owner_spend"
  | "session_spend";

const RUN_REFUSALS: readonly RunRefusal[] = [
  "active",
  "visitor",
  "day",
  "owner_spend",
  "session_spend",
];

/**
 * Creates a Run, counted against the rate limits and the one-Run-per-Desk
 * rule and inserted in one transaction under an advisory lock
 * (`casework.create_run`). `limits` null skips the rate limits (the e2e suite).
 */
export async function createRun(input: {
  sessionId: string;
  pipeline: PipelineId | null;
  jobs: JobId[];
  documentIds: string[];
  visitorHash: string;
  owner: string | null;
  limits: {
    perVisitorPerHour: number;
    perDay: number;
    ownerSpendPerDay: number;
    sessionSpend: number;
  } | null;
}): Promise<{ runId: string } | { refusal: RunRefusal }> {
  const [row] = await sql()<
    { run_id: string | null; refusal: string | null }[]
  >`
    select run_id, refusal from casework.create_run(
      p_session_id => ${input.sessionId}::uuid,
      p_pipeline => ${input.pipeline}::text,
      p_jobs => ${input.jobs}::text[],
      p_document_ids => ${input.documentIds}::uuid[],
      p_visitor_hash => ${input.visitorHash}::text,
      p_per_visitor_per_hour => ${input.limits?.perVisitorPerHour ?? null}::integer,
      p_per_day => ${input.limits?.perDay ?? null}::integer,
      p_owner => ${input.owner}::text,
      p_owner_spend_per_day => ${input.limits?.ownerSpendPerDay ?? null}::numeric,
      p_session_spend => ${input.limits?.sessionSpend ?? null}::numeric
    )`;
  if (row?.run_id) return { runId: row.run_id };
  const refusal = RUN_REFUSALS.find((known) => known === row?.refusal);
  return { refusal: refusal ?? "day" };
}

/** Which cap refused a chat turn. */
export type ChatRefusal = "visitor" | "day" | "owner_spend" | "session_spend";

/**
 * Takes one chat turn before the Specialist's model is called: the caps are
 * checked and the turn recorded in one transaction under an advisory lock
 * (`casework.take_chat_turn`). `limits` null skips them (the e2e suite).
 */
export async function takeChatTurn(input: {
  session: SessionRow;
  limits: {
    perVisitorPerHour: number;
    perDay: number;
    ownerSpendPerDay: number;
    sessionSpend: number;
  } | null;
}): Promise<{ taken: true } | { refusal: ChatRefusal }> {
  const [row] = await sql()<{ taken: boolean; refusal: string | null }[]>`
    select taken, refusal from casework.take_chat_turn(
      p_session_id => ${input.session.id}::uuid,
      p_owner => ${input.session.owner}::text,
      p_visitor_hash => ${input.session.visitor_hash}::text,
      p_per_visitor_per_hour => ${input.limits?.perVisitorPerHour ?? null}::integer,
      p_turns_per_day => ${input.limits?.perDay ?? null}::integer,
      p_owner_spend_per_day => ${input.limits?.ownerSpendPerDay ?? null}::numeric,
      p_session_spend => ${input.limits?.sessionSpend ?? null}::numeric
    )`;
  if (row?.taken) return { taken: true };
  const refusal = row?.refusal;
  return {
    refusal:
      refusal === "visitor" ||
      refusal === "owner_spend" ||
      refusal === "session_spend"
        ? refusal
        : "day",
  };
}

/** USD the Owner's Desks have spent on models since a time, all Desks together. */
export async function ownerSpendUsd(owner: Owner, since: Date) {
  const [row] = await sql()<{ spend: string | null }[]>`
    select casework.owner_spend_usd(
      p_owner => ${owner}::text,
      p_since => ${since.toISOString()}::timestamptz
    ) as spend`;
  return Number(row?.spend ?? 0);
}

type RunPatch = Partial<
  Pick<
    RunRow,
    | "status"
    | "workflow_run_id"
    | "state"
    | "recommendation"
    | "error"
    | "completed_at"
    | "pipeline"
    | "jobs"
    | "document_ids"
  >
>;

/** The columns `updateRun` may set: a fixed list, never the caller's keys. */
const RUN_PATCH_COLUMNS = [
  "status",
  "workflow_run_id",
  "state",
  "recommendation",
  "error",
  "completed_at",
  "pipeline",
  "jobs",
  "document_ids",
] as const satisfies readonly (keyof RunPatch)[];

export async function updateRun(runId: string, patch: RunPatch) {
  // Like the JSON body supabase-js sent: a key left undefined is not written.
  const columns = RUN_PATCH_COLUMNS.filter(
    (column) => patch[column] !== undefined,
  );
  if (columns.length === 0) return;
  const db = sql();
  const values = {
    ...patch,
    ...("state" in patch ? { state: jsonbOrNull(patch.state) } : {}),
  };
  // `jobs` and `document_ids` go as array literals; Postgres types them from the column.
  await db`
    update casework.runs
    set ${db(values as Record<string, unknown>, columns)}
    where id = ${runId}`;
}

export async function getRun(runId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [run] = await sql()<RunRow[]>`
    select * from casework.runs where id = ${runId} limit 1`;
  return run ?? null;
}

export async function runsForSession(sessionId: string) {
  return sql()<RunRow[]>`
    select * from casework.runs
    where session_id = ${sessionId}
    order by created_at desc
    limit 20`;
}

/** A session's latest Runs with what each cost so far, in one query. */
export async function runsWithCosts(sessionId: string) {
  return sql()<(RunRow & { cost_usd: number; calls: number })[]>`
    select r.*, coalesce(c.cost_usd, 0)::float8 as cost_usd, coalesce(c.calls, 0)::int as calls
    from casework.runs r
    left join lateral (
      select sum(m.cost_usd) as cost_usd, count(*) as calls
      from casework.model_calls m where m.run_id = r.id
    ) c on true
    where r.session_id = ${sessionId}
    order by r.created_at desc
    limit 20`;
}

/** Runs of a session that are still going: queued, running or waiting on the person. */
export async function activeRuns(sessionId: string) {
  return sql()<RunRow[]>`
    select * from casework.runs
    where session_id = ${sessionId}
      and status in ('queued', 'running', 'waiting')
    order by created_at desc`;
}

export async function recordJobRun(input: {
  runId: string;
  position: number;
  job: JobId;
  status: "running" | "waiting" | "done" | "skipped" | "failed" | "stopped";
  summary?: string;
  output?: unknown;
}) {
  const finishedAt =
    input.status === "running" || input.status === "waiting"
      ? null
      : new Date().toISOString();
  await sql()`
    insert into casework.job_runs
      (run_id, position, job, status, summary, output, finished_at)
    values (
      ${input.runId}, ${input.position}, ${input.job}, ${input.status},
      ${input.summary ?? null}, ${jsonbOrNull(input.output)}, ${finishedAt}
    )
    on conflict (run_id, position) do update set
      job = excluded.job,
      status = excluded.status,
      summary = excluded.summary,
      output = excluded.output,
      finished_at = excluded.finished_at`;
}

// Questions -----------------------------------------------------------------------

export type QuestionRow = {
  id: string;
  run_id: string;
  job: JobId;
  token: string;
  prompt: string;
  wants: {
    kinds: string[];
    options: { value: string; label: string }[];
    /** Documents on file that look like what is wanted. */
    suggestions?: { id: string; name: string }[];
  };
  answer: Answer | null;
  created_at: string;
  answered_at: string | null;
};

export async function createQuestion(input: {
  runId: string;
  job: JobId;
  token: string;
  prompt: string;
  wants: QuestionRow["wants"];
}) {
  const db = sql();
  return one(
    await db<{ id: string }[]>`
      insert into casework.questions (run_id, job, token, prompt, wants)
      values (
        ${input.runId}, ${input.job}, ${input.token}, ${input.prompt},
        ${jsonb(db, input.wants)}
      )
      on conflict (token) do update set
        run_id = excluded.run_id,
        job = excluded.job,
        prompt = excluded.prompt,
        wants = excluded.wants
      returning id`,
  ).id;
}

export async function getQuestion(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [question] = await sql()<QuestionRow[]>`
    select * from casework.questions where id = ${id} limit 1`;
  return question ?? null;
}

/** A Question with the Desk of its Run, in one query, to check it is the caller's. */
export async function questionWithDesk(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [question] = await sql()<
    (QuestionRow & { session_id: string | null })[]
  >`
    select q.*, r.session_id
    from casework.questions q
    join casework.runs r on r.id = q.run_id
    where q.id = ${id}
    limit 1`;
  return question ?? null;
}

export async function openQuestions(runIds: string[]) {
  if (runIds.length === 0) return [];
  return sql()<QuestionRow[]>`
    select * from casework.questions
    where run_id = any(${runIds}::uuid[]) and answered_at is null
    order by created_at`;
}

export async function markAnswered(questionId: string, answer: Answer) {
  const db = sql();
  await db`
    update casework.questions
    set answer = ${jsonb(db, answer)}, answered_at = ${new Date().toISOString()}
    where id = ${questionId} and answered_at is null`;
}

// Spend ---------------------------------------------------------------------------

export async function recordModelCall(input: {
  sessionId: string | null;
  runId: string | null;
  purpose: Purpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
}) {
  await sql()`
    insert into casework.model_calls (
      session_id, run_id, purpose, model, input_tokens, output_tokens,
      reasoning_tokens, cached_input_tokens, cost_usd, latency_ms
    )
    values (
      ${input.sessionId}, ${input.runId}, ${input.purpose}, ${input.model},
      ${input.inputTokens}, ${input.outputTokens}, ${input.reasoningTokens},
      ${input.cachedInputTokens}, ${Number(input.costUsd.toFixed(6))}, ${input.latencyMs}
    )`;
}

export type SpendRow = {
  purpose: Purpose;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

/** Closes whatever a stopped Run left open: its unfinished jobs and unanswered questions. */
export async function closeStoppedRun(runId: string) {
  const db = sql();
  const now = new Date().toISOString();
  await Promise.all([
    db`
      update casework.job_runs
      set status = 'stopped', finished_at = ${now}
      where run_id = ${runId} and status in ('running', 'waiting')`,
    db`
      update casework.questions
      set answer = ${jsonb(db, { skip: true, text: "Stopped" })}, answered_at = ${now}
      where run_id = ${runId} and answered_at is null`,
  ]);
}

/** Total spend per session, summed in the database. */
export async function spendBySession(sessionIds: string[]) {
  const totals = new Map<string, number>();
  if (sessionIds.length === 0) return totals;
  const rows = await sql()<{ session_id: string; cost_usd: number }[]>`
    select session_id, sum(cost_usd)::float8 as cost_usd
    from casework.model_calls
    where session_id = any(${sessionIds}::uuid[])
    group by session_id`;
  for (const row of rows) totals.set(row.session_id, Number(row.cost_usd));
  return totals;
}

/** A session's spend, by purpose and model, grouped in the database. */
export async function sessionSpend(sessionId: string): Promise<SpendRow[]> {
  const rows = await sql()<SpendRow[]>`
    select purpose, model,
      count(*)::int as calls,
      coalesce(sum(input_tokens), 0)::float8 as "inputTokens",
      coalesce(sum(output_tokens), 0)::float8 as "outputTokens",
      coalesce(sum(cost_usd), 0)::float8 as "costUsd"
    from casework.model_calls
    where session_id = ${sessionId}
    group by purpose, model`;
  return rows.map((row) => ({
    ...row,
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    costUsd: Number(row.costUsd),
  }));
}

/** The labelled Kind and fields of Documents, for the stubbed Reader of the e2e suite. */
export async function documentLabels(ids: string[]) {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return new Map<string, DocumentLabel>();
  const rows = await sql()<(DocumentLabel & { id: string })[]>`
    select id, label_kind, label from casework.documents
    where id = any(${valid}::uuid[])`;
  return new Map(
    rows.map((row) => [
      row.id,
      { label_kind: row.label_kind, label: row.label ?? null },
    ]),
  );
}

export type DocumentLabel = {
  label_kind: string | null;
  label: Record<string, unknown> | null;
};

/** The visitor hash of the outside MCP client's one shared desk. */
const EXTERNAL_VISITOR = "mcp-external";

/** The session an outside MCP client works in: one shared desk, created on first use. */
export async function externalSession() {
  // A failed lookup falls through to a new desk, as it did on the Data API,
  // but is logged rather than hidden. The bearer token is never part of it.
  const found = await sql()<{ id: string }[]>`
    select id from casework.sessions
    where visitor_hash = ${EXTERNAL_VISITOR}
    order by created_at desc
    limit 1`.catch((error: unknown) => {
    console.error(
      "Casework: could not look up the outside MCP client's desk",
      error instanceof Error ? error.message : error,
    );
    return [];
  });
  return found[0]?.id ?? createSession(EXTERNAL_VISITOR, null);
}
