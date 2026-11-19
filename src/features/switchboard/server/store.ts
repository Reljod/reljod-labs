import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { type CallState, NEW_CALL_STATE, type RecordWrite } from "../domain/backoffice";
import type {
  Actor,
  CallEvent,
  CallStatus,
  CallSummary,
  CallView,
  EventData,
  EventType,
  Line,
  Scenario,
  Wrapup,
} from "../domain/contract";
import { LIMITS } from "../domain/limits";
import type { RealtimeUsage } from "../domain/models";
import {
  type Rulebook,
  resolveRulebook,
  type RuleVersionRow,
} from "../domain/rules";
import {
  type BackOfficeRecord,
  RECORD_SCHEMAS,
  type RecordKind,
  SEED_VERSION,
  seedRecords,
} from "../domain/world";
import { type Db, jsonb, sql } from "./db";

/**
 * Everything Switchboard keeps, read and written here and nowhere else.
 * Every function takes the Owner and scopes by it (ADR 0011).
 */

// Workspace -------------------------------------------------------------------------------

async function seed(tx: Db, owner: Owner) {
  for (const record of seedRecords()) {
    await tx`
      insert into switchboard.records (owner, kind, ref, data)
      values (${owner}, ${record.kind}, ${record.ref}, ${jsonb(tx, record.data)})
      on conflict (owner, kind, ref) do update
        set data = excluded.data, call_id = null, updated_at = now()`;
  }
  await tx`
    update switchboard.workspaces
    set seeded_at = now(), seed_version = ${SEED_VERSION}
    where owner = ${owner}`;
}

/** Creates the Owner's Workspace with its Back office on first use. */
export async function ensureWorkspace(owner: Owner) {
  const [row] = await sql()<{ seed_version: number }[]>`
    select seed_version from switchboard.workspaces
    where owner = ${owner} and seeded_at is not null`;
  if (row && row.seed_version >= SEED_VERSION) return;
  await sql().begin(async (tx) => {
    await tx`
      insert into switchboard.workspaces (owner) values (${owner})
      on conflict (owner) do nothing`;
    const [locked] = await tx<{ seed_version: number; seeded: boolean }[]>`
      select seed_version, seeded_at is not null as seeded
      from switchboard.workspaces where owner = ${owner} for update`;
    if (locked?.seeded && locked.seed_version >= SEED_VERSION) return;
    await seed(tx, owner);
  });
}

/** Puts the Back office back to its seed. Calls, Rules and the trail stay. */
export async function resetRecords(owner: Owner) {
  await sql().begin(async (tx) => {
    await tx`select 1 from switchboard.workspaces where owner = ${owner} for update`;
    await tx`delete from switchboard.records where owner = ${owner}`;
    await tx`update switchboard.workspaces set ref_seq = 0 where owner = ${owner}`;
    await seed(tx, owner);
    await emit(tx, owner, null, "owner", "world.reset", {});
  });
}

// Records ---------------------------------------------------------------------------------

type RecordRow = {
  id: string;
  kind: RecordKind;
  ref: string;
  data: unknown;
  call_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const toRecord = (row: RecordRow): BackOfficeRecord =>
  ({
    id: row.id,
    kind: row.kind,
    ref: row.ref,
    data: row.data,
    callId: row.call_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }) as BackOfficeRecord;

export async function listRecords(owner: Owner, db: Db = sql()) {
  const rows = await db<RecordRow[]>`
    select id, kind, ref, data, call_id, created_at, updated_at
    from switchboard.records
    where owner = ${owner}
    order by updated_at desc, ref`;
  return rows.map(toRecord);
}

/** Writes what a tool call changed. Each Record is checked against its kind's schema. */
export async function writeRecords(
  tx: Db,
  owner: Owner,
  callId: string | null,
  writes: RecordWrite[],
) {
  for (const write of writes) {
    const data = RECORD_SCHEMAS[write.kind].parse(write.data);
    await tx`
      insert into switchboard.records (owner, kind, ref, data, call_id)
      values (${owner}, ${write.kind}, ${write.ref}, ${jsonb(tx, data)}, ${callId})
      on conflict (owner, kind, ref) do update
        set data = excluded.data, call_id = excluded.call_id, updated_at = now()`;
  }
}

// Rules -----------------------------------------------------------------------------------

export async function ruleRows(owner: Owner, db: Db = sql()) {
  const rows = await db<
    {
      rule_id: string;
      version: number;
      enabled: boolean;
      params: Record<string, unknown>;
      note: string | null;
      created_at: Date;
    }[]
  >`
    select rule_id, version, enabled, params, note, created_at
    from switchboard.rule_versions
    where owner = ${owner}
    order by rule_id, version desc`;
  return rows.map(
    (row): RuleVersionRow => ({
      ruleId: row.rule_id,
      version: row.version,
      enabled: row.enabled,
      params: row.params,
      note: row.note,
      createdAt: row.created_at.toISOString(),
    }),
  );
}

export async function rulebookOf(owner: Owner, db: Db = sql()): Promise<Rulebook> {
  return resolveRulebook(await ruleRows(owner, db));
}

// Events: the append-only trail -------------------------------------------------------------

type EventRow = {
  id: number;
  call_id: string | null;
  actor: Actor;
  type: EventType;
  data: unknown;
  at: Date;
};

const toEvent = (row: EventRow): CallEvent =>
  ({
    id: row.id,
    callId: row.call_id,
    actor: row.actor,
    type: row.type,
    data: row.data,
    at: row.at.toISOString(),
  }) as CallEvent;

/** Appends one Event. Inside a transaction it lands with the write it records. */
export async function emit<T extends EventType>(
  db: Db,
  owner: Owner,
  callId: string | null,
  actor: Actor,
  type: T,
  data: EventData[T],
): Promise<CallEvent<T>> {
  const [row] = await db<EventRow[]>`
    insert into switchboard.events (owner, call_id, actor, type, data)
    values (${owner}, ${callId}, ${actor}, ${type}, ${jsonb(db, data)})
    returning id, call_id, actor, type, data, at`;
  return toEvent(row) as CallEvent<T>;
}

export async function callEvents(
  owner: Owner,
  callId: string,
  db: Db = sql(),
  afterId = 0,
) {
  const rows = await db<EventRow[]>`
    select id, call_id, actor, type, data, at
    from switchboard.events
    where owner = ${owner} and call_id = ${callId} and id > ${afterId}
    order by id
    limit ${LIMITS.eventsPerCall + 500}`;
  return rows.map(toEvent);
}

/** The Workspace's trail, newest first. */
export async function trail(owner: Owner, input: { before?: number; limit?: number }) {
  const limit = Math.min(200, Math.max(1, input.limit ?? 100));
  const rows = await sql()<EventRow[]>`
    select id, call_id, actor, type, data, at
    from switchboard.events
    where owner = ${owner}
      and type <> 'session.log'
      ${input.before ? sql()`and id < ${input.before}` : sql()``}
    order by id desc
    limit ${limit}`;
  return rows.map(toEvent);
}

// Calls -----------------------------------------------------------------------------------

export type CallRow = {
  id: string;
  owner: Owner;
  line: Line;
  origin: "app" | "mcp";
  status: CallStatus;
  end_reason: string | null;
  model: string;
  scenario: Scenario;
  rulebook: Rulebook;
  state: Partial<CallState>;
  consent_audio: boolean;
  audio_path: string | null;
  usage: RealtimeUsage;
  cost_usd: string;
  wrapup: Wrapup | null;
  wrapup_status: CallView["wrapupStatus"];
  workflow_run_id: string | null;
  deadline_at: Date;
  started_at: Date;
  ended_at: Date | null;
};

export const toCall = (row: CallRow): CallView => ({
  id: row.id,
  line: row.line,
  origin: row.origin,
  status: row.status,
  endReason: row.end_reason,
  model: row.model,
  scenario: row.scenario,
  rulebook: row.rulebook,
  state: { ...NEW_CALL_STATE, ...row.state },
  consentAudio: row.consent_audio,
  hasAudio: Boolean(row.audio_path),
  usage: row.usage,
  costUsd: Number(row.cost_usd),
  wrapup: row.wrapup,
  wrapupStatus: row.wrapup_status,
  deadlineAt: row.deadline_at.toISOString(),
  startedAt: row.started_at.toISOString(),
  endedAt: row.ended_at?.toISOString() ?? null,
});

/** One of the Owner's Calls, or null. `lock` takes the row for the transaction. */
export async function callRow(
  owner: Owner,
  id: string,
  db: Db = sql(),
  lock = false,
): Promise<CallRow | null> {
  const [row] = await db<CallRow[]>`
    select * from switchboard.calls
    where owner = ${owner} and id = ${id}
    ${lock ? db`for update` : db``}`;
  return row ?? null;
}

export async function liveCallRows(owner: Owner, db: Db = sql()) {
  return db<CallRow[]>`
    select * from switchboard.calls
    where owner = ${owner} and status = 'live'
    order by started_at desc`;
}

export async function listCalls(owner: Owner, limit: number = LIMITS.historyCalls) {
  const rows = await sql()<(CallRow & { refusals: number })[]>`
    select c.*,
      (select count(*)::int from switchboard.events e
        where e.call_id = c.id and e.type = 'tool.result'
          and jsonb_array_length(e.data -> 'refusal') > 0) as refusals
    from switchboard.calls c
    where c.owner = ${owner}
    order by c.started_at desc
    limit ${limit}`;
  return rows.map((row): CallSummary => {
    const call = toCall(row);
    return {
      id: call.id,
      line: call.line,
      origin: call.origin,
      status: call.status,
      model: call.model,
      scenario: call.scenario,
      costUsd: call.costUsd,
      wrapupStatus: call.wrapupStatus,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      headline: call.wrapup?.summary ?? null,
      refusals: row.refusals,
      score: call.wrapup
        ? {
            passed: call.wrapup.scorecard.passed,
            failed: call.wrapup.scorecard.failed,
          }
        : null,
    };
  });
}
