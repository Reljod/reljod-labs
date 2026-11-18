import type { Owner } from "@/features/access/domain/owner";
import { type ActorKind, redactDetail } from "../domain/audit";
import { type Actor, actorKind, actorLabel, staffIdOf } from "./actor";
import { type Db, isUuid, jsonb } from "./db";

export type AuditInput = {
  action: string;
  summary: string;
  target?: { kind: string; id: string } | null;
  detail?: Record<string, unknown>;
  usage?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
  } | null;
};

type Who =
  | { actor: Actor }
  | { owner: Owner; system: string; sessionId?: string | null };

/**
 * Writes one Audit event on the given connection. Inside a transaction it
 * stands or falls with the write it records, which is how every command
 * uses it. `bank.audit_events` refuses UPDATE and DELETE.
 */
export async function auditIn(
  db: Db,
  who: Who,
  input: AuditInput,
): Promise<number> {
  const owner = "actor" in who ? who.actor.owner : who.owner;
  const kind: ActorKind = "actor" in who ? actorKind(who.actor) : "system";
  const label = "actor" in who ? actorLabel(who.actor) : who.system;
  const staffId = "actor" in who ? staffIdOf(who.actor) : null;
  const via = "actor" in who ? who.actor.via : "workflow";
  const sessionId = "actor" in who ? who.actor.sessionId : who.sessionId;
  const usage = input.usage ?? null;
  const [row] = await db<{ id: number }[]>`
    insert into bank.audit_events (
      owner, actor_kind, staff_id, actor_label, via, action, target_kind,
      target_id, summary, detail, session_id, model, input_tokens,
      output_tokens, cost_usd, bank_time
    ) values (
      ${owner}, ${kind}, ${staffId}, ${label}, ${via}, ${input.action},
      ${input.target?.kind ?? null}, ${input.target?.id ?? null},
      ${input.summary.slice(0, 300)}, ${jsonb(db, redactDetail(input.detail ?? {}))},
      ${isUuid(sessionId) ? sessionId : null},
      ${usage?.model ?? null},
      ${usage ? Math.round(usage.inputTokens) : null},
      ${usage ? Math.round(usage.outputTokens) : null},
      ${usage?.costUsd ?? null},
      bank.now(${owner})
    )
    returning id`;
  if (!row) throw new Error("Audit event was not written");
  return row.id;
}
