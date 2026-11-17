import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import {
  ACTOR_KINDS,
  type ActorKind,
  type AuditAction,
  type AuditActor,
  type AuditEventView,
  type AuditPage,
  type AuditUsage,
  isAuditAction,
  trimDetails,
} from "../domain/audit";
import { asNumber } from "../metrics";
import { supabase } from "./supabase";

/** Who a person is in the trail. A Host's name is their own to edit, so it is shown, never trusted. */
export function actorOf(access: Access): AuditActor {
  switch (access.kind) {
    case "host":
      return { kind: "person", label: access.name.trim() || "Host" };
    case "guest":
      return { kind: "person", label: `Guest · ${access.label}` };
    case "e2e":
      return { kind: "person", label: "E2E suite" };
  }
}

export type AuditInput = {
  owner: Owner;
  runId: string | null;
  actor: AuditActor;
  action: AuditAction;
  summary: string;
  details?: Record<string, unknown>;
  usage?: AuditUsage | null;
};

/**
 * Appends one Audit event and throws if it cannot. For an event that only
 * reports work already done, call `auditBestEffort` instead; for one that
 * must land with its row, use the database function that writes both.
 */
export async function audit(input: AuditInput): Promise<void> {
  const { error } = await supabase().rpc("append_audit_event", {
    p_owner: input.owner,
    p_run_id: input.runId,
    p_actor_kind: input.actor.kind,
    p_actor_label: input.actor.label,
    p_action: input.action,
    p_summary: input.summary,
    p_details: trimDetails(input.details ?? {}),
    p_model: input.usage?.model ?? null,
    p_input_tokens: input.usage?.inputTokens ?? null,
    p_output_tokens: input.usage?.outputTokens ?? null,
    p_cost_usd: input.usage?.costUsd ?? null,
  });
  if (error)
    throw new Error(`Could not write the Audit event: ${error.message}`);
}

/** Appends an event about work that stands either way: a failure is logged, not thrown. */
export async function auditBestEffort(input: AuditInput): Promise<void> {
  try {
    await audit(input);
  } catch (error) {
    console.error(`[document-compliance] audit ${input.action} lost`, error);
  }
}

type EventRow = {
  id: number;
  run_id: string | null;
  actor_kind: string;
  actor_label: string;
  action: string;
  summary: string;
  details: unknown;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
  created_at: string;
};

function eventView(row: EventRow): AuditEventView | null {
  if (!isAuditAction(row.action)) return null;
  const kind = (ACTOR_KINDS as readonly string[]).includes(row.actor_kind)
    ? (row.actor_kind as ActorKind)
    : "system";
  const hasUsage =
    row.model !== null || row.input_tokens !== null || row.cost_usd !== null;
  return {
    id: row.id,
    at: row.created_at,
    action: row.action,
    actor: { kind, label: row.actor_label },
    runId: row.run_id,
    summary: row.summary,
    details:
      typeof row.details === "object" && row.details !== null
        ? (row.details as Record<string, unknown>)
        : {},
    usage: hasUsage
      ? {
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          costUsd: asNumber(row.cost_usd),
        }
      : null,
  };
}

export const AUDIT_PAGE_SIZE = 50;

/** An Owner's trail, newest first, optionally for one run or one action. */
export async function listAuditEvents(
  owner: Owner,
  filter: {
    runId?: string | null;
    action?: AuditAction | null;
    before?: number | null;
    limit?: number;
  } = {},
): Promise<AuditPage> {
  const limit = Math.min(Math.max(filter.limit ?? AUDIT_PAGE_SIZE, 1), 500);
  let query = supabase()
    .from("audit_events")
    .select(
      "id, run_id, actor_kind, actor_label, action, summary, details, model, input_tokens, output_tokens, cost_usd, created_at",
    )
    .eq("owner", owner)
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (filter.runId) query = query.eq("run_id", filter.runId);
  if (filter.action) query = query.eq("action", filter.action);
  if (filter.before) query = query.lt("id", filter.before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EventRow[];
  const page = rows.slice(0, limit);
  return {
    events: page.flatMap((row) => eventView(row) ?? []),
    before: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}
