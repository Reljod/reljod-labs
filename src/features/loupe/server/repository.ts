import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditAction, AuditEvent } from "../domain/api";
import type {
  DocumentFormat,
  DocumentKind,
  DocumentSource,
  DoneGate,
  Driver,
  ExaminationStatus,
  ExaminationSummary,
  Finding,
  Forgery,
  Hypothesis,
  Measurement,
  PageInfo,
  Review,
  Score,
  SkillId,
  StopReason,
  StoredEvent,
  TrailEvent,
  TrailEventInput,
  UploadSummary,
  VerdictResult,
} from "../domain/contract";
import {
  DEFAULT_RULEBOOK,
  diffRulebooks,
  type Rulebook,
  type RulebookVersion,
  rulebookSchema,
} from "../domain/rules";
import { type Db, isUuid, jsonb, sql } from "./db";

/*
 * Every read and write of Loupe's saved data. Each function takes the Owner
 * and scopes to it (ADR 0011); none calls the gate, which the entry point
 * (page, route, action, MCP tool) has already passed.
 */

// Owners ---------------------------------------------------------------------------

/** The Owner's one top-level row; every other row cascades from it. */
export async function ensureOwner(owner: Owner, db: Db = sql()) {
  await db`insert into loupe.owners (owner) values (${owner}) on conflict do nothing`;
}

// The Examination's working state ----------------------------------------------------

export type ExaminationState = {
  measurements: Measurement[];
  hypotheses: Hypothesis[];
  /** The Examiner's reviews of Sweep Findings, by Measurement id. */
  reviews: Record<string, Review>;
  /** Pages the Examiner looked at. */
  looked: number[];
  skills: SkillId[];
  counters: {
    turns: number;
    codeRuns: number;
    checkRuns: number;
    looks: number;
    /** The next "m<n>" Measurement id. */
    nextMeasurement: number;
  };
  /** How the Sweep's Measurements were taken. */
  sweepMode: "live" | "recorded" | null;
  driver: Driver;
  /** Where the request that started it came in, for a Sample's file. */
  origin: string;
  /** e2e only: scripted Examiner, recorded results, no model and no Sandbox. */
  stub: boolean;
  /** Set by `finish` once the Done gate passed. */
  finished: { summary: string } | null;
};

export function emptyState(
  init: Partial<Pick<ExaminationState, "driver" | "origin" | "stub">> = {},
): ExaminationState {
  return {
    driver: init.driver ?? "examiner",
    origin: init.origin ?? "",
    stub: init.stub ?? false,
    finished: null,
    measurements: [],
    hypotheses: [],
    reviews: {},
    looked: [],
    skills: [],
    counters: {
      turns: 0,
      codeRuns: 0,
      checkRuns: 0,
      looks: 0,
      nextMeasurement: 1,
    },
    sweepMode: null,
  };
}

function stateOf(value: unknown): ExaminationState {
  const base = emptyState();
  if (!value || typeof value !== "object") return base;
  const given = value as Partial<ExaminationState>;
  return {
    ...base,
    ...given,
    counters: { ...base.counters, ...(given.counters ?? {}) },
  };
}

// Rows -------------------------------------------------------------------------------

export type ExaminationRow = {
  id: string;
  owner: Owner;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  source: DocumentSource;
  is_forgery: boolean;
  status: ExaminationStatus;
  model: string;
  examiner: boolean;
  rulebook_version: number;
  rulebook: Rulebook;
  workflow_run_id: string | null;
  cost_usd: number;
  pages: PageInfo[];
  state: ExaminationState;
  findings: Finding[];
  verdict: VerdictResult | null;
  score: Score | null;
  gate: DoneGate | null;
  stopped_by: StopReason | null;
  error: string | null;
  visitor_hash: string;
  via: "app" | "mcp";
  started_at: string;
  ended_at: string | null;
};

type RawExamination = Omit<
  ExaminationRow,
  "cost_usd" | "state" | "started_at" | "ended_at" | "rulebook"
> & {
  cost_usd: string | number;
  state: unknown;
  rulebook: unknown;
  started_at: Date | string;
  ended_at: Date | string | null;
};

const iso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** A stored Rulebook, or the Defaults when a row from an older shape no longer parses. */
function rulebookOf(value: unknown): Rulebook {
  const parsed = rulebookSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_RULEBOOK;
}

function toRow(raw: RawExamination): ExaminationRow {
  return {
    ...raw,
    cost_usd: Number(raw.cost_usd),
    state: stateOf(raw.state),
    rulebook: rulebookOf(raw.rulebook),
    pages: Array.isArray(raw.pages) ? raw.pages : [],
    findings: Array.isArray(raw.findings) ? raw.findings : [],
    started_at: iso(raw.started_at),
    ended_at: raw.ended_at ? iso(raw.ended_at) : null,
  };
}

export function isOver(status: ExaminationStatus | null) {
  return status !== "queued" && status !== "running";
}

export function toSummary(row: ExaminationRow): ExaminationSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    format: row.format,
    source: row.source,
    forgery: row.is_forgery,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    model: row.model,
    driver: row.state.driver,
    rulebookVersion: row.rulebook_version,
    costUsd: row.cost_usd,
    verdict: row.verdict?.verdict ?? null,
    findings: row.findings.filter((finding) => finding.weight !== "context")
      .length,
    score: row.score,
    gatePassed: row.gate?.passed ?? null,
    stoppedBy: row.stopped_by,
    error: row.error,
  };
}

// Rulebooks -------------------------------------------------------------------------

const DEFAULT_VERSION: RulebookVersion = {
  version: 0,
  rulebook: DEFAULT_RULEBOOK,
  createdAt: new Date(0).toISOString(),
  note: null,
  changes: [],
};

type RulebookRow = {
  version: number;
  rulebook: unknown;
  note: string | null;
  changes: unknown;
  created_at: Date | string;
};

function toVersion(row: RulebookRow): RulebookVersion {
  return {
    version: row.version,
    rulebook: rulebookOf(row.rulebook),
    createdAt: iso(row.created_at),
    note: row.note,
    changes: Array.isArray(row.changes) ? (row.changes as string[]) : [],
  };
}

/** Every version, newest first, then the Defaults. The first is the current one. */
export async function listRulebooks(owner: Owner): Promise<RulebookVersion[]> {
  const rows = await sql()<RulebookRow[]>`
    select version, rulebook, note, changes, created_at
    from loupe.rulebooks
    where owner = ${owner}
    order by version desc
    limit 100`;
  return [...rows.map(toVersion), DEFAULT_VERSION];
}

export async function currentRulebook(
  owner: Owner,
  db: Db = sql(),
): Promise<RulebookVersion> {
  const rows = await db<RulebookRow[]>`
    select version, rulebook, note, changes, created_at
    from loupe.rulebooks
    where owner = ${owner}
    order by version desc
    limit 1`;
  return rows[0] ? toVersion(rows[0]) : DEFAULT_VERSION;
}

/**
 * Saves the Rulebook as the Owner's next version, with its Audit event in
 * the same transaction. `perDay` null skips the cap (a trusted visitor).
 */
export async function insertRulebook(input: {
  owner: Owner;
  rulebook: Rulebook;
  note: string | null;
  perDay: number | null;
  via: "app" | "mcp";
}): Promise<{ version: number; changes: string[] } | { refusal: string }> {
  return sql().begin(async (tx) => {
    await ensureOwner(input.owner, tx);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:rulebook:${input.owner}`}, 0))`;
    if (input.perDay !== null) {
      const [{ used }] = await tx<{ used: number }[]>`
        select count(*)::int as used from loupe.rulebooks
        where owner = ${input.owner} and created_at > now() - interval '1 day'`;
      if (used >= input.perDay)
        return {
          refusal: `That's ${used} Rulebook versions today, the demo's daily limit. Try again tomorrow.`,
        };
    }
    const before = await currentRulebook(input.owner, tx);
    const changes = diffRulebooks(before.rulebook, input.rulebook);
    if (changes.length === 0)
      return { refusal: "Nothing changed, so no new version was saved." };
    const version = before.version + 1;
    await tx`
      insert into loupe.rulebooks (owner, version, rulebook, note, changes)
      values (${input.owner}, ${version}, ${jsonb(tx, input.rulebook)}, ${input.note}, ${jsonb(tx, changes)})`;
    await audit(
      input.owner,
      "rulebook.saved",
      input.via,
      { version, changes: changes.length, note: input.note },
      tx,
    );
    return { version, changes };
  });
}

// Uploads ---------------------------------------------------------------------------

export type UploadRow = {
  id: string;
  owner: Owner;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  content_type: string;
  bytes: number;
  storage_path: string;
  forgery: Forgery | null;
  created_at: Date | string;
};

export function toUpload(row: UploadRow): UploadSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    format: row.format,
    bytes: Number(row.bytes),
    forgery: row.forgery,
    createdAt: iso(row.created_at),
  };
}

export async function insertUpload(input: {
  id: string;
  owner: Owner;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  contentType: string;
  bytes: number;
  storagePath: string;
  forgery: Forgery | null;
  visitorHash: string;
  perDay: number | null;
  via: "app" | "mcp";
}): Promise<{ ok: true } | { refusal: string }> {
  return sql().begin(async (tx) => {
    await ensureOwner(input.owner, tx);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:upload:${input.owner}`}, 0))`;
    if (input.perDay !== null) {
      const [{ used }] = await tx<{ used: number }[]>`
        select count(*)::int as used from loupe.uploads
        where owner = ${input.owner} and created_at > now() - interval '1 day'`;
      if (used >= input.perDay)
        return {
          refusal: `That's ${used} uploads today, the demo's daily limit. Try again tomorrow.`,
        };
    }
    await tx`
      insert into loupe.uploads
        (id, owner, title, kind, format, content_type, bytes, storage_path, forgery, visitor_hash)
      values
        (${input.id}, ${input.owner}, ${input.title}, ${input.kind}, ${input.format},
         ${input.contentType}, ${input.bytes}, ${input.storagePath},
         ${input.forgery ? jsonb(tx, input.forgery) : null}, ${input.visitorHash})`;
    await audit(
      input.owner,
      input.forgery ? "forgery.created" : "upload.created",
      input.via,
      {
        uploadId: input.id,
        title: input.title,
        bytes: input.bytes,
        ...(input.forgery
          ? {
              sampleId: input.forgery.sampleId,
              edits: input.forgery.edits.length,
            }
          : {}),
      },
      tx,
    );
    return { ok: true as const };
  });
}

export async function ownedUpload(
  owner: Owner,
  uploadId: string,
): Promise<UploadRow | null> {
  if (!isUuid(uploadId)) return null;
  const rows = await sql()<UploadRow[]>`
    select * from loupe.uploads where id = ${uploadId} and owner = ${owner}`;
  return rows[0] ?? null;
}

export async function listUploads(owner: Owner): Promise<UploadSummary[]> {
  const rows = await sql()<UploadRow[]>`
    select * from loupe.uploads where owner = ${owner}
    order by created_at desc limit 50`;
  return rows.map(toUpload);
}

// Examinations ---------------------------------------------------------------------

export type ExaminationLimits = {
  perOwnerPerDay: number;
  perVisitorPerHour: number;
  activePerOwner: number;
  staleMs: number;
};

/**
 * Creates an Examination under the limits. The counts and the insert run
 * under advisory locks on the Owner and the visitor, so two requests at once
 * cannot both take the last place. `limits` null skips them (a trusted visitor).
 */
export async function createExamination(input: {
  owner: Owner;
  visitorHash: string;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  source: DocumentSource;
  isForgery: boolean;
  model: string;
  driver: Driver;
  origin: string;
  stub: boolean;
  rulebookVersion: number;
  rulebook: Rulebook;
  via: "app" | "mcp";
  limits: ExaminationLimits | null;
}): Promise<{ examinationId: string } | { refusal: string }> {
  return sql().begin(async (tx) => {
    await ensureOwner(input.owner, tx);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:owner:${input.owner}`}, 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:visitor:${input.visitorHash}`}, 0))`;
    if (input.limits) {
      const stale = `${Math.round(input.limits.staleMs / 1000)} seconds`;
      const [{ active, today }] = await tx<{ active: number; today: number }[]>`
        select
          count(*) filter (
            where status in ('queued', 'running')
              and started_at > now() - ${stale}::interval
          )::int as active,
          count(*) filter (where started_at > now() - interval '1 day')::int as today
        from loupe.examinations where owner = ${input.owner}`;
      if (active >= input.limits.activePerOwner)
        return {
          refusal: `You already have ${active} Examination${active === 1 ? "" : "s"} going. Stop one or let it finish first.`,
        };
      if (today >= input.limits.perOwnerPerDay)
        return {
          refusal: `That's ${today} Examinations today, the demo's daily limit. Try again tomorrow.`,
        };
      const [{ hour }] = await tx<{ hour: number }[]>`
        select count(*)::int as hour from loupe.examinations
        where visitor_hash = ${input.visitorHash}
          and started_at > now() - interval '1 hour'`;
      if (hour >= input.limits.perVisitorPerHour)
        return {
          refusal: `That's ${hour} Examinations this hour. Give Loupe a breather and try again later.`,
        };
    }
    const [{ id }] = await tx<{ id: string }[]>`
      insert into loupe.examinations
        (owner, visitor_hash, title, kind, format, source, is_forgery, model,
         examiner, rulebook_version, rulebook, state, via)
      values
        (${input.owner}, ${input.visitorHash}, ${input.title}, ${input.kind},
         ${input.format}, ${jsonb(tx, input.source)}, ${input.isForgery},
         ${input.model}, ${input.driver === "examiner"}, ${input.rulebookVersion},
         ${jsonb(tx, input.rulebook)},
         ${jsonb(tx, emptyState({ driver: input.driver, origin: input.origin, stub: input.stub }))},
         ${input.via})
      returning id`;
    await audit(
      input.owner,
      "examination.started",
      input.via,
      {
        examinationId: id,
        title: input.title,
        source: input.source.kind,
        driver: input.driver,
        model: input.driver === "examiner" ? input.model : null,
        rulebookVersion: input.rulebookVersion,
      },
      tx,
    );
    return { examinationId: id };
  });
}

export async function getExamination(
  examinationId: string,
  db: Db = sql(),
): Promise<ExaminationRow | null> {
  if (!isUuid(examinationId)) return null;
  const rows = await db<RawExamination[]>`
    select * from loupe.examinations where id = ${examinationId}`;
  return rows[0] ? toRow(rows[0]) : null;
}

/** The Examination, only if it is this Owner's. */
export async function ownedExamination(
  owner: Owner,
  examinationId: string,
): Promise<ExaminationRow | null> {
  if (!isUuid(examinationId)) return null;
  const rows = await sql()<RawExamination[]>`
    select * from loupe.examinations
    where id = ${examinationId} and owner = ${owner}`;
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listExaminations(
  owner: Owner,
): Promise<ExaminationSummary[]> {
  const rows = await sql()<RawExamination[]>`
    select id, owner, title, kind, format, source, is_forgery, status, model,
      examiner, rulebook_version, workflow_run_id, cost_usd, findings, verdict,
      score, gate, stopped_by, error, visitor_hash, via, started_at, ended_at,
      '[]'::jsonb as pages,
      jsonb_build_object('driver', coalesce(state->>'driver', 'examiner')) as state,
      'null'::jsonb as rulebook
    from loupe.examinations
    where owner = ${owner}
    order by started_at desc
    limit 40`;
  return rows.map((row) => toSummary(toRow(row)));
}

export async function examinationStatus(
  examinationId: string,
): Promise<ExaminationStatus | null> {
  if (!isUuid(examinationId)) return null;
  const rows = await sql()<{ status: ExaminationStatus }[]>`
    select status from loupe.examinations where id = ${examinationId}`;
  return rows[0]?.status ?? null;
}

type Patch = Partial<{
  status: ExaminationStatus;
  workflow_run_id: string;
  cost_usd: number;
  kind: DocumentKind;
  pages: PageInfo[];
  findings: Finding[];
  verdict: VerdictResult | null;
  score: Score | null;
  gate: DoneGate | null;
  stopped_by: StopReason | null;
  error: string | null;
  rulebook_version: number;
  rulebook: Rulebook;
}>;

const JSON_COLUMNS = new Set([
  "pages",
  "findings",
  "verdict",
  "score",
  "gate",
  "rulebook",
]);

function assignments(db: Db, patch: Patch) {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values[key] =
      JSON_COLUMNS.has(key) && value !== null ? jsonb(db, value) : value;
  }
  return values;
}

export async function updateExamination(
  examinationId: string,
  patch: Patch,
  db: Db = sql(),
) {
  const values = assignments(db, patch);
  if (Object.keys(values).length === 0) return;
  await db`update loupe.examinations set ${db(values)} where id = ${examinationId}`;
}

/**
 * Ends an Examination still going; one already ended keeps its status. True
 * only for the call that ended it.
 */
export async function endExaminationIfGoing(
  examinationId: string,
  patch: Patch & { status: "completed" | "failed" | "stopped" },
): Promise<boolean> {
  const db = sql();
  const values = { ...assignments(db, patch), ended_at: new Date() };
  const rows = await db`
    update loupe.examinations set ${db(values)}
    where id = ${examinationId} and status in ('queued', 'running')
    returning id`;
  return rows.length > 0;
}

/**
 * Changes an Examination's working state under a row lock, so the Examiner's
 * tools and an outside client's cannot lose each other's writes. `change`
 * returns the next state and whatever the caller wants back, or a refusal,
 * which leaves the state as it was.
 */
export async function mutateState<T>(
  examinationId: string,
  change: (
    row: ExaminationRow,
  ) =>
    | { state: ExaminationState; patch?: Patch; result: T }
    | { refusal: string },
): Promise<{ result: T; row: ExaminationRow } | { refusal: string }> {
  return sql().begin(async (tx) => {
    const rows = await tx<RawExamination[]>`
      select * from loupe.examinations where id = ${examinationId} for update`;
    if (!rows[0]) return { refusal: "No such Examination." };
    const row = toRow(rows[0]);
    const next = change(row);
    if ("refusal" in next) return next;
    const values = {
      ...assignments(tx, next.patch ?? {}),
      state: jsonb(tx, next.state),
    };
    await tx`update loupe.examinations set ${tx(values)} where id = ${examinationId}`;
    return {
      result: next.result,
      row: {
        ...row,
        ...(next.patch ?? {}),
        state: next.state,
      } as ExaminationRow,
    };
  });
}

// The Trail --------------------------------------------------------------------------

export async function insertEvents(
  examinationId: string,
  events: (TrailEventInput & { at?: number })[],
  db: Db = sql(),
) {
  if (events.length === 0) return;
  const rows = events.map((event) => {
    const {
      type,
      at: _at,
      ...payload
    } = event as TrailEventInput & {
      at?: number;
    };
    return { examination_id: examinationId, type, payload: jsonb(db, payload) };
  });
  // One statement, so the events of one call get consecutive seqs in order.
  await db`insert into loupe.examination_events ${db(rows)}`;
}

type EventRow = {
  seq: number;
  at: Date | string;
  type: string;
  payload: Record<string, unknown>;
};

function toEvent(row: EventRow): StoredEvent {
  return {
    ...row.payload,
    type: row.type,
    seq: Number(row.seq),
    at: new Date(row.at).getTime(),
  } as TrailEvent & { seq: number };
}

export async function eventsAfter(
  examinationId: string,
  after: number,
  limit = 500,
): Promise<StoredEvent[]> {
  const rows = await sql()<EventRow[]>`
    select seq, at, type, payload from loupe.examination_events
    where examination_id = ${examinationId} and seq > ${after}
    order by seq asc
    limit ${limit}`;
  return rows.map(toEvent);
}

export async function allEvents(examinationId: string): Promise<StoredEvent[]> {
  const rows = await sql()<EventRow[]>`
    select seq, at, type, payload from loupe.examination_events
    where examination_id = ${examinationId}
    order by seq asc
    limit 5000`;
  return rows.map(toEvent);
}

export async function recordModelCall(record: {
  examinationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
}) {
  await sql()`
    insert into loupe.model_calls
      (examination_id, model, input_tokens, output_tokens, cached_input_tokens, cost_usd, latency_ms)
    values
      (${record.examinationId}, ${record.model}, ${record.inputTokens},
       ${record.outputTokens}, ${record.cachedInputTokens},
       ${Number(record.costUsd.toFixed(6))}, ${Math.round(record.latencyMs)})`;
}

// The Audit trail ------------------------------------------------------------------

/**
 * Appends one Audit event. Inside a transaction (`db`) it stands or falls
 * with the write it records. Details hold ids, names and sizes only.
 */
export async function audit(
  owner: Owner,
  action: AuditAction,
  via: "app" | "mcp",
  detail: Record<string, string | number | boolean | null>,
  db: Db = sql(),
) {
  await db`
    insert into loupe.audit_events (owner, action, via, detail)
    values (${owner}, ${action}, ${via}, ${jsonb(db, detail)})`;
}

export async function listAudit(owner: Owner): Promise<AuditEvent[]> {
  const rows = await sql()<
    {
      id: number;
      at: Date | string;
      action: AuditAction;
      via: "app" | "mcp";
      detail: AuditEvent["detail"];
    }[]
  >`
    select id, at, action, via, detail from loupe.audit_events
    where owner = ${owner}
    order by id desc
    limit 200`;
  return rows.map((row) => ({
    id: Number(row.id),
    at: iso(row.at),
    action: row.action,
    via: row.via,
    detail: row.detail ?? {},
  }));
}

// Hourly caps ----------------------------------------------------------------------

export type RateKind = "check" | "reevaluate" | "token";

/**
 * Counts one unit of capped work, or returns why it was refused. By visitor
 * (`check`) or by Owner (`reevaluate`, `token`), over `windowHours`, under an
 * advisory lock so two requests at once cannot both take the last place.
 */
export async function takeRate(input: {
  owner: Owner;
  visitorHash: string;
  kind: RateKind;
  by: "visitor" | "owner";
  limit: number;
  windowHours: number;
  what: string;
}): Promise<{ ok: true } | { refusal: string }> {
  const key = input.by === "visitor" ? input.visitorHash : input.owner;
  return sql().begin(async (tx) => {
    await ensureOwner(input.owner, tx);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:rate:${input.kind}:${key}`}, 0))`;
    const window = `${input.windowHours} hours`;
    const [{ used }] =
      input.by === "visitor"
        ? await tx<{ used: number }[]>`
            select count(*)::int as used from loupe.rate_events
            where visitor_hash = ${input.visitorHash} and kind = ${input.kind}
              and at > now() - ${window}::interval`
        : await tx<{ used: number }[]>`
            select count(*)::int as used from loupe.rate_events
            where owner = ${input.owner} and kind = ${input.kind}
              and at > now() - ${window}::interval`;
    if (used >= input.limit)
      return {
        refusal: `That's ${used} ${input.what} ${input.windowHours === 1 ? "this hour" : "today"}. Try again later.`,
      };
    await tx`
      insert into loupe.rate_events (owner, visitor_hash, kind)
      values (${input.owner}, ${input.visitorHash}, ${input.kind})`;
    return { ok: true as const };
  });
}

// The Toolkit snapshot ---------------------------------------------------------------

export async function snapshotFor(hash: string): Promise<string | null> {
  const rows = await sql()<{ snapshot_id: string }[]>`
    select snapshot_id from loupe.toolkit_snapshots where requirements_hash = ${hash}`;
  return rows[0]?.snapshot_id ?? null;
}

export async function saveSnapshot(hash: string, snapshotId: string) {
  await sql()`
    insert into loupe.toolkit_snapshots (requirements_hash, snapshot_id)
    values (${hash}, ${snapshotId})
    on conflict (requirements_hash)
    do update set snapshot_id = excluded.snapshot_id, created_at = now()`;
}

export async function forgetSnapshot(hash: string) {
  await sql()`delete from loupe.toolkit_snapshots where requirements_hash = ${hash}`;
}
