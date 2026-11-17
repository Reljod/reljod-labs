import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  type ActorKind,
  type AuditAction,
  type AuditEvent,
  type AuditInput,
  actorLabel,
  isAuditAction,
  redactDetail,
} from "../domain/audit";
import { LIMITS } from "../domain/limits";
import { can } from "../domain/permissions";
import type { Staff } from "../domain/staff";
import { type Db, isUuid, jsonb, sql } from "./db";

type AuditRow = {
  id: number;
  session_id: string | null;
  run_id: string | null;
  actor_kind: ActorKind;
  staff_id: string | null;
  actor_label: string;
  action: AuditAction;
  target_kind: string | null;
  target_id: string | null;
  summary: string;
  detail: Record<string, unknown>;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  created_at: Date;
  session_title?: string | null;
};

const eventOf = (row: AuditRow): AuditEvent => ({
  id: row.id,
  sessionId: row.session_id,
  sessionTitle: row.session_title ?? null,
  runId: row.run_id,
  actorKind: row.actor_kind,
  staffId: row.staff_id,
  actorLabel: row.actor_label,
  action: row.action,
  targetKind: row.target_kind,
  targetId: row.target_id,
  summary: row.summary,
  detail: row.detail ?? {},
  model: row.model,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  createdAt: row.created_at.toISOString(),
});

export type OwnedAuditInput = AuditInput & { owner: Owner };

const SUMMARY_CHARS = 300;

async function insert(db: Db, input: OwnedAuditInput): Promise<number> {
  if (!isAuditAction(input.action)) {
    throw new Error(`Unknown Audit action "${String(input.action)}"`);
  }
  const usage = input.usage ?? null;
  const [row] = await db<{ id: number }[]>`
    insert into harness.audit_events (
      owner, session_id, run_id, actor_kind, staff_id, actor_label, action,
      target_kind, target_id, summary, detail,
      model, input_tokens, output_tokens, cost_usd
    ) values (
      ${input.owner},
      ${isUuid(input.sessionId) ? input.sessionId : null},
      ${isUuid(input.runId) ? input.runId : null},
      ${input.actor.kind},
      ${input.actor.kind === "staff" ? input.actor.staff.id : null},
      ${actorLabel(input.actor)},
      ${input.action},
      ${input.target?.kind ?? null},
      ${input.target?.id ?? null},
      ${input.summary.slice(0, SUMMARY_CHARS)},
      ${jsonb(db, redactDetail(input.detail))},
      ${usage?.model ?? null},
      ${usage ? Math.round(usage.inputTokens) : null},
      ${usage ? Math.round(usage.outputTokens) : null},
      ${usage?.costUsd ?? null}
    )
    returning id`;
  if (!row) throw new Error("Audit event was not written");
  return row.id;
}

/**
 * Writes one Audit event (ADR 0018). Every server function that writes calls
 * this, or `auditIn`, in the same function that does the work.
 *
 * It does not throw into the caller in production: the work it records has
 * already happened, and failing a chat turn or a Run because the trail's
 * insert failed would lose the work and still not record it. The failure is
 * logged (action and Owner kind only, never the details) and null is
 * returned. Outside production it throws, so an unknown action or a schema
 * drift is seen the first time it runs.
 *
 * Best effort is only for events written after the fact. When the event and
 * the work must stand or fall together, do not use this:
 * - with a row to share a transaction (`run.started`, a Rule saved, an
 *   Approval decided, a Conflict settled), use `auditIn` in it;
 * - with none (`mcp.connected`, `sandbox.command`), use `auditStrict` before
 *   the work, and do not do the work if it throws.
 */
export async function audit(input: OwnedAuditInput): Promise<number | null> {
  try {
    return await insert(sql(), input);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") throw error;
    console.error("[harness] audit failed", input.action, error);
    return null;
  }
}

/**
 * Writes one Audit event inside the caller's transaction. Always throws on
 * failure, so the write it records is rolled back with it.
 */
export async function auditIn(tx: Db, input: OwnedAuditInput): Promise<number> {
  return insert(tx, input);
}

/** Writes several Audit events in order, with `audit`'s failure rule. */
export async function auditMany(
  inputs: OwnedAuditInput[],
): Promise<(number | null)[]> {
  const ids: (number | null)[] = [];
  for (const input of inputs) ids.push(await audit(input));
  return ids;
}

export type AuditFilter = {
  owner: Owner;
  /** Who is reading: decides how much of the trail they see. */
  staff: Pick<Staff, "id" | "role">;
  sessionId?: string | null;
  actorKind?: ActorKind | null;
  action?: AuditAction | null;
  /** An admin's "My Sessions": only the events of the Sessions they own. */
  mine?: boolean;
  /** Events older than this event id. */
  before?: number | null;
  limit?: number | null;
};

/**
 * Reads the Audit trail, newest first. An admin reads the whole Workspace's;
 * a user reads only the events of Sessions that are theirs, whatever filter
 * they send. `nextBefore` is null at the end of the trail.
 */
export async function listAudit(filter: AuditFilter): Promise<{
  events: AuditEvent[];
  nextBefore: number | null;
  scope: "workspace" | "own";
}> {
  const db = sql();
  const whole = can(filter.staff, "audit.read.workspace");
  const scope = whole ? ("workspace" as const) : ("own" as const);
  if (filter.sessionId && !isUuid(filter.sessionId)) {
    return { events: [], nextBefore: null, scope };
  }
  const limit = Math.max(
    1,
    Math.min(
      Math.trunc(filter.limit ?? LIMITS.auditPageSize),
      LIMITS.auditPageSize,
    ),
  );
  const before =
    typeof filter.before === "number" && Number.isFinite(filter.before)
      ? Math.trunc(filter.before)
      : null;
  const rows = await db<AuditRow[]>`
    select e.id, e.session_id, e.run_id, e.actor_kind, e.staff_id,
           e.actor_label, e.action, e.target_kind, e.target_id, e.summary,
           e.detail, e.model, e.input_tokens, e.output_tokens, e.cost_usd,
           e.created_at, ss.title as session_title
    from harness.audit_events e
    left join harness.sessions ss
      on ss.id = e.session_id and ss.owner = e.owner
    where e.owner = ${filter.owner}
      ${
        whole
          ? db``
          : db`and e.session_id in (
              select s.id from harness.sessions s
              where s.owner = ${filter.owner} and s.staff_id = ${filter.staff.id}
            )`
      }
      ${
        whole && filter.mine
          ? db`and e.session_id in (
              select s.id from harness.sessions s
              where s.owner = ${filter.owner} and s.staff_id = ${filter.staff.id}
            )`
          : db``
      }
      ${filter.sessionId ? db`and e.session_id = ${filter.sessionId}` : db``}
      ${filter.actorKind ? db`and e.actor_kind = ${filter.actorKind}` : db``}
      ${filter.action ? db`and e.action = ${filter.action}` : db``}
      ${before !== null ? db`and e.id < ${before}` : db``}
    order by e.id desc
    limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  return {
    events: page.map(eventOf),
    nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    scope,
  };
}

/**
 * Writes one Audit event and throws if it cannot, in production too. For an
 * action that has no transaction to share and must not happen untraced (a
 * Sandbox command): write the event first, and do the action only if this
 * returned.
 */
export async function auditStrict(
  input: Parameters<typeof audit>[0],
): Promise<void> {
  await insert(sql(), input);
}
