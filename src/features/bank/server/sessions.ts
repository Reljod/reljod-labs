import "server-only";
import { listConfirmations } from "../core/reads";
import type { MessageView, SessionSummary } from "../domain/chat";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import type { SessionRepository } from "./ports";

/**
 * Chat Sessions with the Teller, in `bank.sessions` and `bank.messages`.
 * Every statement is scoped to the Owner and skips soft-deleted Sessions
 * (`deleted_at`); the `bank-purge-deleted-sessions` cron deletes them with
 * their messages 30 days later. Callers pass ids already checked as uuids.
 */

const columns = (db: ReturnType<typeof sql>) =>
  db`id, title, staff_id, customer_id, created_at, updated_at`;

export const sessionRepository: SessionRepository = {
  async list(owner) {
    const db = sql();
    return db<SessionSummary[]>`
      select ${columns(db)} from bank.sessions
      where owner = ${owner} and deleted_at is null
      order by updated_at desc limit ${LIMITS.sessionsPerBank}`;
  },

  async find(owner, sessionId) {
    const db = sql();
    const [session] = await db<SessionSummary[]>`
      select ${columns(db)} from bank.sessions
      where owner = ${owner} and id = ${sessionId} and deleted_at is null`;
    return session ?? null;
  },

  async count(owner) {
    const [row] = await sql()<{ count: number }[]>`
      select count(*)::int as count from bank.sessions
      where owner = ${owner} and deleted_at is null`;
    return row?.count ?? 0;
  },

  async create(owner, staffId, customerId) {
    const db = sql();
    const [session] = await db<SessionSummary[]>`
      insert into bank.sessions (owner, staff_id, customer_id)
      select ${owner}, ${staffId},
        (select id from bank.customers where owner = ${owner} and id = ${customerId})
      returning ${columns(db)}`;
    if (!session) throw new Error("The conversation was not created");
    return session;
  },

  async remove(owner, sessionId) {
    const rows = await sql()`
      update bank.sessions set deleted_at = now()
      where owner = ${owner} and id = ${sessionId} and deleted_at is null
      returning id`;
    return rows.length > 0;
  },

  async rename(owner, sessionId, title) {
    const db = sql();
    const [session] = await db<SessionSummary[]>`
      update bank.sessions set title = ${title}, updated_at = now()
      where owner = ${owner} and id = ${sessionId} and deleted_at is null
      returning ${columns(db)}`;
    return session ?? null;
  },

  async messages(owner, sessionId) {
    const rows = await sql()<
      (Omit<MessageView, "costUsd"> & { costUsd: string | null })[]
    >`
      select id, role, content, parts, model, input_tokens, output_tokens, cost_usd, created_at
      from bank.messages m
      where m.owner = ${owner} and m.session_id = ${sessionId}
        and exists (
          select 1 from bank.sessions s
          where s.id = m.session_id and s.owner = ${owner} and s.deleted_at is null
        )
      order by created_at, id limit 400`;
    return rows.map((row) => ({
      ...row,
      costUsd: row.costUsd === null ? null : Number(row.costUsd),
    }));
  },

  async append(input) {
    const db = sql();
    // One statement: the message, and the Session moved to the top of the list.
    const [row] = await db<{ id: string }[]>`
      with session as (
        update bank.sessions set updated_at = now()
        where owner = ${input.owner} and id = ${input.sessionId} and deleted_at is null
        returning id
      )
      insert into bank.messages (session_id, owner, role, content, parts, model, input_tokens, output_tokens, cost_usd)
      select s.id, ${input.owner}, ${input.role}, ${input.content},
             ${db.json((input.parts ?? []) as never)}, ${input.usage?.model ?? null},
             ${input.usage ? Math.round(input.usage.inputTokens) : null},
             ${input.usage ? Math.round(input.usage.outputTokens) : null},
             ${input.usage?.costUsd ?? null}
      from session s
      returning id`;
    return row?.id ?? null;
  },

  async confirmations(owner, sessionId) {
    return (await listConfirmations(sql(), owner, { sessionId })).confirmations;
  },
};
