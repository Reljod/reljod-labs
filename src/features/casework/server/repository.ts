import "server-only";
import type { Scenario } from "../domain/case-file";
import type { JobId } from "../domain/jobs";
import type { ModelSettings, Purpose } from "../domain/model-config";
import type { PipelineId } from "../domain/pipelines";
import type { Answer } from "../domain/run-events";
import type { RunDocument, RunState, SourceFormat } from "../domain/run-state";
import { supabase } from "./supabase";

function rows<T>(result: {
  data: unknown;
  error: { message: string } | null;
}): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === undefined) {
    throw new Error("Query returned no data");
  }
  return result.data as T;
}

function ok(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

// Sessions ---------------------------------------------------------------------

export type SessionRow = {
  id: string;
  visitor_hash: string;
  model_overrides: Partial<Record<Purpose, Partial<ModelSettings>>>;
  created_at: string;
};

export async function createSession(visitorHash: string) {
  return rows<{ id: string }>(
    await supabase()
      .from("sessions")
      .insert({ visitor_hash: visitorHash })
      .select("id")
      .single(),
  ).id;
}

export async function getSession(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [session] = rows<SessionRow[]>(
    await supabase().from("sessions").select("*").eq("id", id).limit(1),
  );
  return session ?? null;
}

export async function setModelOverrides(
  sessionId: string,
  overrides: SessionRow["model_overrides"],
) {
  ok(
    await supabase()
      .from("sessions")
      .update({ model_overrides: overrides })
      .eq("id", sessionId),
  );
}

export async function orgModelSettings() {
  const settings = rows<
    {
      purpose: Purpose;
      model: string;
      reasoning: ModelSettings["reasoning"];
      temperature: number | null;
      max_output_tokens: number | null;
    }[]
  >(await supabase().from("model_settings").select("*"));
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

const DOCUMENT_COLUMNS =
  "id, case_file_slug, session_id, name, media_type, source_format, storage_path, page_paths, size_bytes, label_kind, created_at";

export async function loadCaseFiles() {
  return rows<CaseFileRow[]>(
    await supabase()
      .from("case_files")
      .select("slug, scenario, title, summary, as_of, split, position")
      .order("position"),
  );
}

export async function loadCabinetDocuments(sessionId: string) {
  return rows<DocumentRow[]>(
    await supabase()
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .or(`case_file_slug.not.is.null,session_id.eq.${sessionId}`)
      .order("name"),
  );
}

/** Documents by id that this session may use: the Cabinet's, or its own uploads. */
export async function documentsByIds(ids: string[], sessionId: string | null) {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return [];
  const found = rows<DocumentRow[]>(
    await supabase().from("documents").select(DOCUMENT_COLUMNS).in("id", valid),
  );
  return found.filter(
    (document) => document.case_file_slug || document.session_id === sessionId,
  );
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
  const dates = rows<{ as_of: string }[]>(
    await supabase().from("case_files").select("as_of").in("slug", slugs),
  );
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
}) {
  return rows<DocumentRow>(
    await supabase()
      .from("documents")
      .insert({
        session_id: input.sessionId,
        name: input.name,
        media_type: input.mediaType,
        source_format: input.sourceFormat,
        storage_path: input.storagePath,
        page_paths: input.pagePaths,
        size_bytes: input.sizeBytes,
      })
      .select(DOCUMENT_COLUMNS)
      .single(),
  );
}

export async function countUploads(sessionId: string) {
  const { count, error } = await supabase()
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Messages ------------------------------------------------------------------------

export type MessageRow = {
  id: number;
  session_id: string;
  role: "user" | "specialist";
  text: string;
  document_ids: string[];
  run_id: string | null;
  tool_calls: { name: string; input: unknown; output?: unknown }[];
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
  return rows<{ id: number }>(
    await supabase()
      .from("messages")
      .insert({
        session_id: input.sessionId,
        role: input.role,
        text: input.text,
        document_ids: input.documentIds ?? [],
        run_id: input.runId ?? null,
        tool_calls: input.toolCalls ?? [],
      })
      .select("id")
      .single(),
  ).id;
}

export async function loadMessages(sessionId: string, limit = 40) {
  const recent = rows<MessageRow[]>(
    await supabase()
      .from("messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("id", { ascending: false })
      .limit(limit),
  );
  return recent.reverse();
}

export async function countMessages(filter: {
  sessionIds?: string[];
  visitorHash?: string;
  since: Date;
}) {
  let query = supabase()
    .from("messages")
    .select("id, sessions!inner(visitor_hash)", { count: "exact", head: true })
    .eq("role", "user")
    .gte("created_at", filter.since.toISOString());
  if (filter.visitorHash)
    query = query.eq("sessions.visitor_hash", filter.visitorHash);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Runs ----------------------------------------------------------------------------

export type RunRow = {
  id: string;
  session_id: string | null;
  pipeline: PipelineId | null;
  jobs: JobId[];
  document_ids: string[];
  status: "queued" | "running" | "waiting" | "completed" | "failed";
  workflow_run_id: string | null;
  state: RunState | null;
  recommendation: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function createRun(input: {
  sessionId: string;
  pipeline: PipelineId | null;
  jobs: JobId[];
  documentIds: string[];
  visitorHash: string;
}) {
  return rows<{ id: string }>(
    await supabase()
      .from("runs")
      .insert({
        session_id: input.sessionId,
        pipeline: input.pipeline,
        jobs: input.jobs,
        document_ids: input.documentIds,
        visitor_hash: input.visitorHash,
      })
      .select("id")
      .single(),
  ).id;
}

export async function updateRun(
  runId: string,
  patch: Partial<
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
  >,
) {
  ok(await supabase().from("runs").update(patch).eq("id", runId));
}

export async function getRun(runId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [run] = rows<RunRow[]>(
    await supabase().from("runs").select("*").eq("id", runId).limit(1),
  );
  return run ?? null;
}

export async function runsForSession(sessionId: string) {
  return rows<RunRow[]>(
    await supabase()
      .from("runs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(20),
  );
}

export async function countRuns(filter: { visitorHash?: string; since: Date }) {
  let query = supabase()
    .from("runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", filter.since.toISOString());
  if (filter.visitorHash) query = query.eq("visitor_hash", filter.visitorHash);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function recordJobRun(input: {
  runId: string;
  position: number;
  job: JobId;
  status: "running" | "waiting" | "done" | "skipped" | "failed";
  summary?: string;
  output?: unknown;
}) {
  ok(
    await supabase()
      .from("job_runs")
      .upsert(
        {
          run_id: input.runId,
          position: input.position,
          job: input.job,
          status: input.status,
          summary: input.summary ?? null,
          output: input.output ?? null,
          finished_at:
            input.status === "running" || input.status === "waiting"
              ? null
              : new Date().toISOString(),
        },
        { onConflict: "run_id,position" },
      ),
  );
}

// Questions -----------------------------------------------------------------------

export type QuestionRow = {
  id: string;
  run_id: string;
  job: JobId;
  token: string;
  prompt: string;
  wants: { kinds: string[]; options: { value: string; label: string }[] };
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
  return rows<{ id: string }>(
    await supabase()
      .from("questions")
      .upsert(
        {
          run_id: input.runId,
          job: input.job,
          token: input.token,
          prompt: input.prompt,
          wants: input.wants,
        },
        { onConflict: "token" },
      )
      .select("id")
      .single(),
  ).id;
}

export async function getQuestion(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [question] = rows<QuestionRow[]>(
    await supabase().from("questions").select("*").eq("id", id).limit(1),
  );
  return question ?? null;
}

export async function openQuestions(runIds: string[]) {
  if (runIds.length === 0) return [];
  return rows<QuestionRow[]>(
    await supabase()
      .from("questions")
      .select("*")
      .in("run_id", runIds)
      .is("answered_at", null)
      .order("created_at"),
  );
}

export async function markAnswered(questionId: string, answer: Answer) {
  ok(
    await supabase()
      .from("questions")
      .update({ answer, answered_at: new Date().toISOString() })
      .eq("id", questionId)
      .is("answered_at", null),
  );
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
  ok(
    await supabase()
      .from("model_calls")
      .insert({
        session_id: input.sessionId,
        run_id: input.runId,
        purpose: input.purpose,
        model: input.model,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        reasoning_tokens: input.reasoningTokens,
        cached_input_tokens: input.cachedInputTokens,
        cost_usd: Number(input.costUsd.toFixed(6)),
        latency_ms: input.latencyMs,
      }),
  );
}

export type SpendRow = {
  purpose: Purpose;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

/** A session's spend, by purpose and model. */
export async function sessionSpend(sessionId: string): Promise<SpendRow[]> {
  const calls = rows<
    {
      purpose: Purpose;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }[]
  >(
    await supabase()
      .from("model_calls")
      .select("purpose, model, input_tokens, output_tokens, cost_usd")
      .eq("session_id", sessionId),
  );
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

export async function deleteSessionsByVisitor(visitorHash: string) {
  ok(
    await supabase().from("sessions").delete().eq("visitor_hash", visitorHash),
  );
}
