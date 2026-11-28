import "server-only";
import { type Db, db, jsonb } from "@/server/postgres";
import { isUuid } from "../domain/ids";
import { LIMITS } from "../domain/limits";
import {
  type ActorKind,
  isTrailAction,
  redactDetail,
  type TrailAction,
  type TrailEvent,
} from "../domain/trail";
import type { Caller, TrailInput, TrailRepository } from "./ports";

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
  created_at: string;
};

/** A timestamp as `toISOString()` writes it, whatever the pool parsed it into. */
export const iso = (value: string | Date) => new Date(value).toISOString();

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
  createdAt: iso(row.created_at),
});

/** Inside a transaction: the write and its event stand or fall together. */
export async function trailIn(
  tx: Db,
  caller: Caller,
  input: TrailInput,
): Promise<number> {
  if (!isTrailAction(input.action))
    throw new Error(`Unknown Trail action "${String(input.action)}"`);
  const [row] = await tx<{ id: number }[]>`
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
      ${jsonb(tx, redactDetail(input.detail))},
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

/** The Trail in Postgres (`canvas.events`, which refuses UPDATE and DELETE). */
export const trailRepository: TrailRepository = {
  /**
   * Best effort in production: the work it records has already happened,
   * so a failed insert is logged (action only) and the caller carries on.
   * Outside production it throws, so an unknown action or a schema drift
   * shows the first time it runs.
   */
  async record(caller, input) {
    try {
      return await trailIn(db(), caller, input);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") throw error;
      console.error("[canvas] trail failed", input.action, error);
      return null;
    }
  },

  strict: (caller, input) => trailIn(db(), caller, input),

  async list(owner, filter) {
    const sql = db();
    const limit = Math.min(filter.limit ?? LIMITS.trailPageSize, 500);
    const rows = await sql<Row[]>`
      select id, conversation_id, question_id, view_id, board_id, actor_kind,
             action, summary, detail, model, input_tokens, output_tokens,
             cost_usd, ms, created_at
      from canvas.events
      where owner = ${owner}
        ${isUuid(filter.conversationId) ? sql`and conversation_id = ${filter.conversationId}` : sql``}
        ${isUuid(filter.questionId) ? sql`and question_id = ${filter.questionId}` : sql``}
        ${isUuid(filter.viewId) ? sql`and view_id = ${filter.viewId}` : sql``}
        ${isUuid(filter.boardId) ? sql`and board_id = ${filter.boardId}` : sql``}
        ${filter.before ? sql`and id < ${filter.before}` : sql``}
      order by id desc
      limit ${limit}`;
    return rows.map(eventOf);
  },
};
