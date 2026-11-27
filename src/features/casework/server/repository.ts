import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { jsonb } from "@/server/postgres";
import type { Scenario } from "../domain/case-file";
import type { JobId } from "../domain/jobs";
import type { ModelSettings, Purpose } from "../domain/model-config";
import type { PipelineId } from "../domain/pipelines";
import type { Answer } from "../domain/run-events";
import type { RunDocument, RunState, SourceFormat } from "../domain/run-state";
import { sql } from "./db";

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

export async function insertUpload(input: {
  sessionId: string;
  name: string;
  mediaType: string;
  sourceFormat: SourceFormat;
  storagePath: string;
  pagePaths: string[];
  sizeBytes: number;
}): Promise<DocumentRow | null> {
  const db = sql();
  try {
    return one(
      await db<DocumentRow[]>`
        insert into casework.documents
          (session_id, name, media_type, source_format, storage_path, page_paths, size_bytes)
        values (
          ${input.sessionId}, ${input.name}, ${input.mediaType}, ${input.sourceFormat},
          ${input.storagePath}, ${input.pagePaths}::text[], ${input.sizeBytes}
        )
        returning ${db(DOCUMENT_COLUMNS)}`,
    );
  } catch (error) {
    // An upload's path is recorded once (a unique index): a ticket used twice
    // at the same moment records nothing the second time.
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
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
  const [row] = await sql()<{ run_id: string | null; refusal: string | null }[]>`
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
  await db`
    update casework.job_runs
    set status = 'stopped', finished_at = ${now}
    where run_id = ${runId} and status in ('running', 'waiting')`;
  await db`
    update casework.questions
    set answer = ${jsonb(db, { skip: true, text: "Stopped" })}, answered_at = ${now}
    where run_id = ${runId} and answered_at is null`;
}

/** What each Run cost, for the Runs given. */
export async function runCosts(runIds: string[]) {
  const totals = new Map<string, { costUsd: number; calls: number }>();
  if (runIds.length === 0) return totals;
  // `cost_usd` is `numeric`, which Postgres sends as a string.
  const calls = await sql()<{ run_id: string; cost_usd: string }[]>`
    select run_id, cost_usd from casework.model_calls
    where run_id = any(${runIds}::uuid[])`;
  for (const call of calls) {
    const total = totals.get(call.run_id) ?? { costUsd: 0, calls: 0 };
    total.costUsd += Number(call.cost_usd);
    total.calls += 1;
    totals.set(call.run_id, total);
  }
  return totals;
}

/** Total spend per session, for the list of earlier desks. */
export async function spendBySession(sessionIds: string[]) {
  const totals = new Map<string, number>();
  if (sessionIds.length === 0) return totals;
  const calls = await sql()<{ session_id: string; cost_usd: string }[]>`
    select session_id, cost_usd from casework.model_calls
    where session_id = any(${sessionIds}::uuid[])`;
  for (const call of calls)
    totals.set(
      call.session_id,
      (totals.get(call.session_id) ?? 0) + Number(call.cost_usd),
    );
  return totals;
}

/** A session's spend, by purpose and model. */
export async function sessionSpend(sessionId: string): Promise<SpendRow[]> {
  const calls = await sql()<
    {
      purpose: Purpose;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: string;
    }[]
  >`
    select purpose, model, input_tokens, output_tokens, cost_usd
    from casework.model_calls
    where session_id = ${sessionId}`;
  const grouped = new Map<string, SpendRow>();
  for (const call of calls) {
    const key = `${call.purpose}|${call.model}`;
    const row = grouped.get(key) ?? {
      purpose: call.purpose,
      model: call.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    row.calls += 1;
    row.inputTokens += call.input_tokens;
    row.outputTokens += call.output_tokens;
    row.costUsd += Number(call.cost_usd);
    grouped.set(key, row);
  }
  return [...grouped.values()];
}
