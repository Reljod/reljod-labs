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
  const [row] = rows<{ run_id: string | null; refusal: string | null }[]>(
    await supabase().rpc("create_run", {
      p_owner: input.owner,
      p_visitor_hash: input.visitorHash,
      p_title: input.title.slice(0, 200),
      p_pages: input.pages,
      p_source: input.source,
      p_models: input.models,
      p_rulebook_version: input.rulebookVersion,
      p_rulebook: input.rulebook,
      p_per_owner_per_day: input.limits?.perOwnerPerDay ?? null,
      p_per_visitor_per_hour: input.limits?.perVisitorPerHour ?? null,
      p_active_per_owner: input.limits?.activePerOwner ?? null,
    }),
  );
  if (row?.run_id) return { runId: row.run_id };
  return { refusal: row?.refusal ?? "The run could not be started." };
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
  ok(await supabase().from("runs").update(patch).eq("id", runId));
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
  const ended = rows<{ id: string }[]>(
    await supabase()
      .from("runs")
      .update({ ...patch, ended_at: new Date().toISOString() })
      .eq("id", runId)
      .in("status", ["queued", "running"])
      .select("id"),
  );
  return ended.length > 0;
}

/** A Run by id, with no Owner check: for the workflow and the stream only. */
export async function getRunRow(runId: string): Promise<RunRow | null> {
  if (!isUuid(runId)) return null;
  const [run] = rows<RunRow[]>(
    await supabase().from("runs").select("*").eq("id", runId).limit(1),
  );
  return run ?? null;
}

/** A Run, if the Owner owns it. */
export async function ownedRun(
  owner: Owner,
  runId: string,
): Promise<RunRow | null> {
  if (!isUuid(runId)) return null;
  const [run] = rows<RunRow[]>(
    await supabase()
      .from("runs")
      .select("*")
      .eq("id", runId)
      .eq("owner", owner)
      .limit(1),
  );
  return run ?? null;
}

export async function runsOf(owner: Owner, limit = 50): Promise<RunRow[]> {
  return rows<RunRow[]>(
    await supabase()
      .from("runs")
      .select("*")
      .eq("owner", owner)
      .order("started_at", { ascending: false })
      .limit(limit),
  );
}

/** Whether a Run was stopped: the workflow checks it between turns. */
export async function runStatus(runId: string): Promise<RunStatus | null> {
  const [row] = rows<{ status: RunStatus }[]>(
    await supabase().from("runs").select("status").eq("id", runId).limit(1),
  );
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
  ok(
    await supabase()
      .from("run_events")
      .insert(
        events.map(({ type, at, ...payload }) => ({
          run_id: runId,
          type,
          at: new Date(at ?? Date.now()).toISOString(),
          payload,
        })),
      ),
  );
}

/** A Run's events after a cursor, in order. */
export async function eventsAfter(
  runId: string,
  afterSeq: number,
  limit = 500,
): Promise<StoredEvent[]> {
  return rows<EventRow[]>(
    await supabase()
      .from("run_events")
      .select("seq, at, type, payload")
      .eq("run_id", runId)
      .gt("seq", afterSeq)
      .order("seq", { ascending: true })
      .limit(limit),
  ).map(toEvent);
}

/** Every event of a Run, in pages of 1000 (the Data API's cap per request). */
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
  ok(
    await supabase()
      .from("model_calls")
      .insert({
        run_id: input.runId,
        purpose: input.purpose,
        model: input.model,
        input_tokens: Math.max(0, Math.round(input.inputTokens)),
        output_tokens: Math.max(0, Math.round(input.outputTokens)),
        cached_input_tokens: Math.max(0, Math.round(input.cachedInputTokens)),
        cost_usd: Math.max(0, input.costUsd),
        latency_ms: Math.max(0, Math.round(input.latencyMs)),
      }),
  );
}

/** What a Run's model calls cost so far, in USD. */
export async function runSpend(runId: string) {
  const calls = rows<{ cost_usd: string | number }[]>(
    await supabase().from("model_calls").select("cost_usd").eq("run_id", runId),
  );
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
  const [row] = rows<RulebookRow[]>(
    await supabase()
      .from("rulebooks")
      .select("version, rulebook, note, created_at")
      .eq("owner", owner)
      .order("version", { ascending: false })
      .limit(1),
  );
  return (row && toVersion(row)) ?? DEFAULT_VERSION;
}

/** Every version the Owner saved, newest first, then the default. */
export async function rulebookVersions(
  owner: Owner,
  limit = 100,
): Promise<RulebookVersion[]> {
  const saved = rows<RulebookRow[]>(
    await supabase()
      .from("rulebooks")
      .select("version, rulebook, note, created_at")
      .eq("owner", owner)
      .order("version", { ascending: false })
      .limit(limit),
  );
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
  const [row] = rows<{ version: number | null; refusal: string | null }[]>(
    await supabase().rpc("save_rulebook", {
      p_owner: owner,
      p_rulebook: rulebook,
      p_note: note,
      p_per_owner_per_day: perOwnerPerDay,
    }),
  );
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
  ok(
    await supabase().from("uploads").insert({
      id: input.id,
      owner: input.owner,
      title: input.title,
      pages: input.pages,
      storage_path: input.storagePath,
    }),
  );
}

export async function ownedUpload(
  owner: Owner,
  uploadId: string,
): Promise<UploadRow | null> {
  if (!isUuid(uploadId)) return null;
  const [row] = rows<UploadRow[]>(
    await supabase()
      .from("uploads")
      .select("*")
      .eq("id", uploadId)
      .eq("owner", owner)
      .limit(1),
  );
  return row ?? null;
}

/** An Upload by id with no Owner check: for the workflow, which got the id from an owned Run. */
export async function getUpload(uploadId: string): Promise<UploadRow | null> {
  if (!isUuid(uploadId)) return null;
  const [row] = rows<UploadRow[]>(
    await supabase().from("uploads").select("*").eq("id", uploadId).limit(1),
  );
  return row ?? null;
}

export async function countUploadsSince(owner: Owner, since: Date) {
  const { count, error } = await supabase()
    .from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("owner", owner)
    .gte("created_at", since.toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}
