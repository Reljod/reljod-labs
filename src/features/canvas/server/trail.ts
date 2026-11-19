import "server-only";
import { LIMITS } from "../domain/limits";
import {
  type ActorKind,
  isTrailAction,
  redactDetail,
  type TrailAction,
  type TrailEvent,
  type TrailUsage,
} from "../domain/trail";
import type { Caller } from "./caller";
import { type Db, isUuid, jsonb, sql } from "./db";

export type TrailInput = {
  action: TrailAction;
  summary: string;
  detail?: Record<string, unknown>;
  viewId?: string | null;
  boardId?: string | null;
  usage?: TrailUsage;
  ms?: number;
  /** Overrides the Caller's actor: a tool the Analyst called writes as the Analyst. */
  actor?: ActorKind;
};

type Row = {
  id: number;
  conversation_id: string | null;
  question_id: string | null;
  view_id: string | null;
  board_id: string | null;
  actor_kind: ActorKind;
  action: TrailAction;
  summary: string;
  detail: Record<string, unknown>;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  ms: number | null;
  created_at: Date;
};

const eventOf = (row: Row): TrailEvent => ({
  id: row.id,
  conversationId: row.conversation_id,
  questionId: row.question_id,
  viewId: row.view_id,
  boardId: row.board_id,
  actorKind: row.actor_kind,
  action: row.action,
  summary: row.summary,
  detail: row.detail ?? {},
  model: row.model,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  ms: row.ms,
  createdAt: row.created_at.toISOString(),
});

async function insert(db: Db, caller: Caller, input: TrailInput) {
  if (!isTrailAction(input.action))
    throw new Error(`Unknown Trail action "${String(input.action)}"`);
  const [row] = await db<{ id: number }[]>`
    insert into canvas.events (
      owner, conversation_id, question_id, view_id, board_id, actor_kind,
      action, summary, detail, model, input_tokens, output_tokens, cost_usd, ms
    ) values (
      ${caller.owner},
      ${isUuid(caller.conversationId) ? caller.conversationId : null},
      ${isUuid(caller.questionId) ? caller.questionId : null},
      ${isUuid(input.viewId) ? input.viewId : null},
      ${isUuid(input.boardId) ? input.boardId : null},
      ${input.actor ?? caller.actor},
      ${input.action},
      ${input.summary.slice(0, 300)},
      ${jsonb(db, redactDetail(input.detail))},
      ${input.usage?.model ?? null},
      ${input.usage ? Math.round(input.usage.inputTokens) : null},
      ${input.usage ? Math.round(input.usage.outputTokens) : null},
      ${input.usage?.costUsd ?? null},
      ${input.ms === undefined ? null : Math.max(0, Math.round(input.ms))}
    )
    returning id`;
  if (!row) throw new Error("Trail event was not written");
  return row.id;
}

/**
 * Writes one Trail event after the fact. Best effort in production: the work
 * it records has already happened, so a failed insert is logged (action
 * only) and the caller carries on. Outside production it throws, so an
 * unknown action or a schema drift shows the first time it runs.
 */
export async function trail(
  caller: Caller,
  input: TrailInput,
): Promise<number | null> {
  try {
    return await insert(sql(), caller, input);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") throw error;
    console.error("[canvas] trail failed", input.action, error);
    return null;
  }
}

/** For an event that must be on the Trail before the work happens: throws if it cannot be written. */
export function trailStrict(caller: Caller, input: TrailInput) {
  return insert(sql(), caller, input);
}

/** Inside a transaction: the write and its event stand or fall together. */
export function trailIn(tx: Db, caller: Caller, input: TrailInput) {
  return insert(tx, caller, input);
}

export type TrailFilter = {
  conversationId?: string;
  questionId?: string;
  viewId?: string;
  boardId?: string;
  /** Events older than this id. */
  before?: number;
  limit?: number;
};

/** A page of the Owner's Trail, newest first. */
export async function listTrail(
  caller: Pick<Caller, "owner">,
  filter: TrailFilter = {},
): Promise<TrailEvent[]> {
  const db = sql();
  const limit = Math.min(filter.limit ?? LIMITS.trailPageSize, 500);
  const rows = await db<Row[]>`
    select id, conversation_id, question_id, view_id, board_id, actor_kind,
           action, summary, detail, model, input_tokens, output_tokens,
           cost_usd, ms, created_at
    from canvas.events
    where owner = ${caller.owner}
      ${isUuid(filter.conversationId) ? db`and conversation_id = ${filter.conversationId}` : db``}
      ${isUuid(filter.questionId) ? db`and question_id = ${filter.questionId}` : db``}
      ${isUuid(filter.viewId) ? db`and view_id = ${filter.viewId}` : db``}
      ${isUuid(filter.boardId) ? db`and board_id = ${filter.boardId}` : db``}
      ${filter.before ? db`and id < ${filter.before}` : db``}
    order by id desc
    limit ${limit}`;
  return rows.map(eventOf);
}
