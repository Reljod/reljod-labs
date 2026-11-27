import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { LimitError } from "@/platform/errors";
import type { RateLimiter } from "@/platform/rate/limiter";
import { type Db, jsonb, db as pool } from "@/server/postgres";
import type { AuditAction, AuditEvent } from "../domain/api";
import type {
  ExaminationStatus,
  ExaminationSummary,
  StoredEvent,
  TrailEvent,
  TrailEventInput,
  UploadSummary,
} from "../domain/contract";
import {
  DEFAULT_RULEBOOK,
  diffRulebooks,
  type Rulebook,
  type RulebookVersion,
  rulebookSchema,
} from "../domain/rules";
import {
  type ExaminationPatch,
  type ExaminationPulse,
  type ExaminationRow,
  type ExaminationState,
  emptyState,
  isUuid,
  toSummary,
} from "./examination";
import type {
  AuditDetail,
  AuditRepository,
  ExaminationRepository,
  RateKind,
  RulebookRepository,
  TrailRepository,
  UploadRepository,
  UploadRow,
} from "./ports";

/*
 * Every read and write of Loupe's saved data, on the shared pool. Each
 * function takes the Owner and scopes to it (ADR 0011); none calls the gate,
 * which the entry point (route, page, MCP token) has already passed. The
 * services reach them through the repositories at the bottom of this file.
 */

// Owners ---------------------------------------------------------------------------

/** The Owner's one top-level row; every other row cascades from it. */
async function ensureOwner(owner: Owner, db: Db = pool()) {
  await db`insert into loupe.owners (owner) values (${owner}) on conflict do nothing`;
}

// Rows -------------------------------------------------------------------------------

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

async function currentRulebook(
  owner: Owner,
  db: Db = pool(),
): Promise<RulebookVersion> {
  const rows = await db<RulebookRow[]>`
    select version, rulebook, note, changes, created_at
    from loupe.rulebooks
    where owner = ${owner}
    order by version desc
    limit 1`;
  return rows[0] ? toVersion(rows[0]) : DEFAULT_VERSION;
}

export const rulebookRepository: RulebookRepository = {
  async list(owner) {
    const rows = await pool()<RulebookRow[]>`
      select version, rulebook, note, changes, created_at
      from loupe.rulebooks
      where owner = ${owner}
      order by version desc
      limit 100`;
    return [...rows.map(toVersion), DEFAULT_VERSION];
  },

  current: (owner) => currentRulebook(owner),

  insert(input) {
    return pool().begin(async (tx) => {
      await ensureOwner(input.owner, tx);
      await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:rulebook:${input.owner}`}, 0))`;
      if (input.perDay !== null) {
        const [{ used }] = await tx<{ used: number }[]>`
          select count(*)::int as used from loupe.rulebooks
          where owner = ${input.owner} and created_at > now() - interval '1 day'`;
        if (used >= input.perDay) return { over: used };
      }
      const before = await currentRulebook(input.owner, tx);
      const changes = diffRulebooks(before.rulebook, input.rulebook);
      if (changes.length === 0) return { unchanged: true as const };
      const version = before.version + 1;
      await tx`
        insert into loupe.rulebooks (owner, version, rulebook, note, changes)
        values (${input.owner}, ${version}, ${jsonb(tx, input.rulebook)}, ${input.note}, ${jsonb(tx, changes)})`;
      await appendAudit(
        input.owner,
        "rulebook.saved",
        input.via,
        { version, changes: changes.length, note: input.note },
        tx,
      );
      return { version, changes };
    });
  },
};

// Uploads ---------------------------------------------------------------------------

function toUpload(row: UploadRow): UploadSummary {
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

export const uploadRepository: UploadRepository = {
  insert(input) {
    return pool().begin(async (tx) => {
      await ensureOwner(input.owner, tx);
      await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:upload:${input.owner}`}, 0))`;
      if (input.perDay !== null) {
        const [{ used }] = await tx<{ used: number }[]>`
          select count(*)::int as used from loupe.uploads
          where owner = ${input.owner} and created_at > now() - interval '1 day'`;
        if (used >= input.perDay) return { over: used };
      }
      await tx`
        insert into loupe.uploads
          (id, owner, title, kind, format, content_type, bytes, storage_path, forgery, visitor_hash)
        values
          (${input.id}, ${input.owner}, ${input.title}, ${input.kind}, ${input.format},
           ${input.contentType}, ${input.bytes}, ${input.storagePath},
           ${input.forgery ? jsonb(tx, input.forgery) : null}, ${input.visitorHash})`;
      await appendAudit(
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
  },

  async owned(owner, uploadId) {
    if (!isUuid(uploadId)) return null;
    const rows = await pool()<UploadRow[]>`
      select * from loupe.uploads where id = ${uploadId} and owner = ${owner}`;
    return rows[0] ?? null;
  },

  async list(owner) {
    const rows = await pool()<UploadRow[]>`
      select * from loupe.uploads where owner = ${owner}
      order by created_at desc limit 50`;
    return rows.map(toUpload);
  },
};

// Examinations ---------------------------------------------------------------------

const JSON_COLUMNS = new Set([
  "pages",
  "findings",
  "verdict",
  "score",
  "gate",
  "rulebook",
]);

function assignments(db: Db, patch: ExaminationPatch) {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values[key] =
      JSON_COLUMNS.has(key) && value !== null ? jsonb(db, value) : value;
  }
  return values;
}

async function getExamination(
  examinationId: string,
): Promise<ExaminationRow | null> {
  if (!isUuid(examinationId)) return null;
  const rows = await pool()<RawExamination[]>`
    select * from loupe.examinations where id = ${examinationId}`;
  return rows[0] ? toRow(rows[0]) : null;
}

type RawPulse = Omit<
  ExaminationPulse,
  "started_at" | "pageCount" | "stub" | "origin" | "driver"
> & {
  started_at: Date | string;
  page_count: number;
  stub: boolean | null;
  origin: string | null;
  driver: ExaminationPulse["driver"] | null;
};

export const examinationRepository: ExaminationRepository = {
  /**
   * The counts and the insert run under advisory locks on the Owner and the
   * visitor, so two requests at once cannot both take the last place.
   */
  create(input) {
    return pool().begin(async (tx) => {
      await ensureOwner(input.owner, tx);
      await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:owner:${input.owner}`}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:visitor:${input.visitorHash}`}, 0))`;
      if (input.limits) {
        const stale = `${Math.round(input.limits.staleMs / 1000)} seconds`;
        // The Owner's and the visitor's counts in one round trip.
        const [{ active, today, hour }] = await tx<
          { active: number; today: number; hour: number }[]
        >`
          select
            (select count(*) from loupe.examinations
              where owner = ${input.owner} and status in ('queued', 'running')
                and started_at > now() - ${stale}::interval)::int as active,
            (select count(*) from loupe.examinations
              where owner = ${input.owner}
                and started_at > now() - interval '1 day')::int as today,
            (select count(*) from loupe.examinations
              where visitor_hash = ${input.visitorHash}
                and started_at > now() - interval '1 hour')::int as hour`;
        if (active >= input.limits.activePerOwner)
          return { over: "active" as const, count: active };
        if (today >= input.limits.perOwnerPerDay)
          return { over: "day" as const, count: today };
        if (hour >= input.limits.perVisitorPerHour)
          return { over: "hour" as const, count: hour };
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
      await appendAudit(
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
  },

  get: getExamination,

  async owned(owner, examinationId) {
    if (!isUuid(examinationId)) return null;
    const rows = await pool()<RawExamination[]>`
      select * from loupe.examinations
      where id = ${examinationId} and owner = ${owner}`;
    return rows[0] ? toRow(rows[0]) : null;
  },

  async owns(owner, examinationId) {
    if (!isUuid(examinationId)) return false;
    const rows = await pool()`
      select 1 from loupe.examinations
      where id = ${examinationId} and owner = ${owner}`;
    return rows.length > 0;
  },

  async pulse(examinationId) {
    if (!isUuid(examinationId)) return null;
    const rows = await pool()<RawPulse[]>`
      select id, owner, status, started_at, visitor_hash, verdict, error,
        state->>'driver' as driver,
        jsonb_array_length(pages)::int as page_count,
        (state->>'stub')::boolean as stub,
        state->>'origin' as origin
      from loupe.examinations where id = ${examinationId}`;
    const raw = rows[0];
    if (!raw) return null;
    const { page_count, stub, origin, driver, started_at, ...rest } = raw;
    return {
      ...rest,
      started_at: iso(started_at),
      pageCount: page_count,
      stub: stub === true,
      origin: origin ?? "",
      driver: driver ?? "examiner",
    };
  },

  async list(owner): Promise<ExaminationSummary[]> {
    const rows = await pool()<RawExamination[]>`
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
  },

  async update(examinationId, patch) {
    const db = pool();
    const values = assignments(db, patch);
    if (Object.keys(values).length === 0) return;
    await db`update loupe.examinations set ${db(values)} where id = ${examinationId}`;
  },

  async endIfGoing(examinationId, patch) {
    const db = pool();
    const values = { ...assignments(db, patch), ended_at: new Date() };
    const rows = await db`
      update loupe.examinations set ${db(values)}
      where id = ${examinationId} and status in ('queued', 'running')
      returning id`;
    return rows.length > 0;
  },

  /**
   * `change` returns the next state and whatever the caller wants back, or a
   * refusal, which leaves the state as it was.
   */
  mutate(examinationId, change) {
    return pool().begin(async (tx) => {
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
  },
};

/** For the Sandbox: whether a command should still run. */
export async function examinationStatus(
  examinationId: string,
): Promise<ExaminationStatus | null> {
  if (!isUuid(examinationId)) return null;
  const rows = await pool()<{ status: ExaminationStatus }[]>`
    select status from loupe.examinations where id = ${examinationId}`;
  return rows[0]?.status ?? null;
}

// The Trail --------------------------------------------------------------------------

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

export const trailRepository: TrailRepository = {
  async append(examinationId, events) {
    if (events.length === 0) return;
    const db = pool();
    const rows = events.map((event) => {
      const {
        type,
        at: _at,
        ...payload
      } = event as TrailEventInput & {
        at?: number;
      };
      return {
        examination_id: examinationId,
        type,
        payload: jsonb(db, payload),
      };
    });
    // One statement, so the events of one call get consecutive seqs in order.
    await db`insert into loupe.examination_events ${db(rows)}`;
  },

  async after(examinationId, after, limit = 500) {
    if (!isUuid(examinationId)) return [];
    const rows = await pool()<EventRow[]>`
      select seq, at, type, payload from loupe.examination_events
      where examination_id = ${examinationId} and seq > ${after}
      order by seq asc
      limit ${limit}`;
    return rows.map(toEvent);
  },

  async all(examinationId) {
    if (!isUuid(examinationId)) return [];
    const rows = await pool()<EventRow[]>`
      select seq, at, type, payload from loupe.examination_events
      where examination_id = ${examinationId}
      order by seq asc
      limit 5000`;
    return rows.map(toEvent);
  },
};

export async function recordModelCall(record: {
  examinationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
}) {
  await pool()`
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
async function appendAudit(
  owner: Owner,
  action: AuditAction,
  via: "app" | "mcp",
  detail: AuditDetail,
  db: Db = pool(),
) {
  await db`
    insert into loupe.audit_events (owner, action, via, detail)
    values (${owner}, ${action}, ${via}, ${jsonb(db, detail)})`;
}

export const auditRepository: AuditRepository = {
  ensureOwner: (owner) => ensureOwner(owner),
  append: (owner, action, via, detail) =>
    appendAudit(owner, action, via, detail),
  async list(owner): Promise<AuditEvent[]> {
    const rows = await pool()<
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
  },
};

// Caps -----------------------------------------------------------------------------

/** One of Loupe's own caps: counted per visitor or per Owner, over a window of hours. */
export type OwnerCap = {
  by: "visitor" | "owner";
  limit: number;
  windowHours: number;
  /** What is counted, for the refusal ("Checks", "tokens"). */
  what: string;
};

/**
 * Loupe's caps outside an Examination's own, over `loupe.rate_events`. The
 * platform's `pgRateLimiter` counts per visitor or for everyone over
 * `<schema>.rate_hits`; Loupe also caps per Owner (re-evaluations, tokens)
 * and keeps its own table, so it implements the same contract here. The
 * count and the insert run under an advisory lock, so two requests at once
 * cannot both take the last place. A trusted visitor (the e2e suite) is
 * never limited.
 */
export function loupeRateLimiter(
  caps: Record<RateKind, OwnerCap>,
): RateLimiter<RateKind> {
  return {
    async take(kind, who, options = {}) {
      if (who.trusted) return;
      const owner = options.owner;
      if (!owner) throw new Error("Loupe's caps are taken for an Owner.");
      const cap = caps[kind];
      const key = cap.by === "visitor" ? who.hash : owner;
      const refusal = await pool().begin(async (tx) => {
        await ensureOwner(owner, tx);
        await tx`select pg_advisory_xact_lock(hashtextextended(${`loupe:rate:${kind}:${key}`}, 0))`;
        const window = `${cap.windowHours} hours`;
        const [{ used }] =
          cap.by === "visitor"
            ? await tx<{ used: number }[]>`
                select count(*)::int as used from loupe.rate_events
                where visitor_hash = ${who.hash} and kind = ${kind}
                  and at > now() - ${window}::interval`
            : await tx<{ used: number }[]>`
                select count(*)::int as used from loupe.rate_events
                where owner = ${owner} and kind = ${kind}
                  and at > now() - ${window}::interval`;
        if (used >= cap.limit)
          return `That's ${used} ${cap.what} ${cap.windowHours === 1 ? "this hour" : "today"}. Try again later.`;
        await tx`
          insert into loupe.rate_events (owner, visitor_hash, kind)
          values (${owner}, ${who.hash}, ${kind})`;
        return null;
      });
      if (refusal) throw new LimitError(refusal);
    },

    async used(who, kinds) {
      const zero = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<
        RateKind,
        number
      >;
      if (who.trusted || kinds.length === 0) return zero;
      const db = pool();
      const rows = await db<{ kind: RateKind; used: number }[]>`
        select kind, count(*)::int as used from loupe.rate_events
        where visitor_hash = ${who.hash} and at > now() - interval '1 hour'
          and kind in ${db(kinds as RateKind[])}
        group by 1`;
      for (const row of rows) zero[row.kind] = row.used;
      return zero;
    },
  };
}

// The Toolkit snapshot ---------------------------------------------------------------

export async function snapshotFor(hash: string): Promise<string | null> {
  const rows = await pool()<{ snapshot_id: string }[]>`
    select snapshot_id from loupe.toolkit_snapshots where requirements_hash = ${hash}`;
  return rows[0]?.snapshot_id ?? null;
}

export async function saveSnapshot(hash: string, snapshotId: string) {
  await pool()`
    insert into loupe.toolkit_snapshots (requirements_hash, snapshot_id)
    values (${hash}, ${snapshotId})
    on conflict (requirements_hash)
    do update set snapshot_id = excluded.snapshot_id, created_at = now()`;
}

export async function forgetSnapshot(hash: string) {
  await pool()`delete from loupe.toolkit_snapshots where requirements_hash = ${hash}`;
}
