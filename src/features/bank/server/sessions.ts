import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { isUuid } from "../core/db";
import { LimitError, NotFoundError } from "../core/errors";
import type { MessagePart, MessageView, SessionSummary } from "../domain/chat";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import type { Usage } from "./llm";

/** Chat Sessions with the Teller. Every one is the Owner's; every read is scoped to them. */

const columns = (db: ReturnType<typeof sql>) =>
  db`id, title, staff_id, customer_id, created_at, updated_at`;

export async function listSessions(owner: Owner): Promise<SessionSummary[]> {
  const db = sql();
  return db<SessionSummary[]>`
    select ${columns(db)} from bank.sessions where owner = ${owner}
    order by updated_at desc limit ${LIMITS.sessionsPerBank}`;
}

export async function ownedSession(
  owner: Owner,
  sessionId: string,
): Promise<SessionSummary> {
  const db = sql();
  const [session] = isUuid(sessionId)
    ? await db<SessionSummary[]>`
        select ${columns(db)} from bank.sessions where owner = ${owner} and id = ${sessionId}`
    : [];
  if (!session)
    throw new NotFoundError("That conversation is not in this bank.");
  return session;
}

export async function createSession(
  owner: Owner,
  staffId: string,
  customerId: string | null,
): Promise<SessionSummary> {
  const db = sql();
  const [count] = await db<{ count: number }[]>`
    select count(*)::int as count from bank.sessions where owner = ${owner}`;
  if ((count?.count ?? 0) >= LIMITS.sessionsPerBank) {
    throw new LimitError(
      `This bank keeps at most ${LIMITS.sessionsPerBank} conversations. Delete one first.`,
    );
  }
  const [session] = await db<SessionSummary[]>`
    insert into bank.sessions (owner, staff_id, customer_id)
    select ${owner}, ${staffId},
      (select id from bank.customers where owner = ${owner} and id = ${isUuid(customerId) ? customerId : null})
    returning ${columns(db)}`;
  if (!session) throw new Error("The conversation was not created");
  return session;
}

export async function deleteSession(
  owner: Owner,
  sessionId: string,
): Promise<void> {
  await ownedSession(owner, sessionId);
  await sql()`delete from bank.sessions where owner = ${owner} and id = ${sessionId}`;
}

export async function setSession(
  owner: Owner,
  sessionId: string,
  change: { title?: string; customerId?: string | null },
): Promise<SessionSummary> {
  const db = sql();
  const [session] = await db<SessionSummary[]>`
    update bank.sessions set
      title = coalesce(${change.title ?? null}, title),
      customer_id = case when ${change.customerId !== undefined}
        then (select id from bank.customers where owner = ${owner} and id = ${isUuid(change.customerId) ? change.customerId : null})
        else customer_id end,
      updated_at = now()
    where owner = ${owner} and id = ${sessionId}
    returning ${columns(db)}`;
  if (!session)
    throw new NotFoundError("That conversation is not in this bank.");
  return session;
}

export async function listMessages(
  owner: Owner,
  sessionId: string,
): Promise<MessageView[]> {
  const rows = await sql()<
    (Omit<MessageView, "costUsd"> & { costUsd: string | null })[]
  >`
    select id, role, content, parts, model, input_tokens, output_tokens, cost_usd, created_at
    from bank.messages where owner = ${owner} and session_id = ${sessionId}
    order by created_at, id limit 400`;
  return rows.map((row) => ({
    ...row,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
  }));
}

export async function appendMessage(input: {
  owner: Owner;
  sessionId: string;
  role: "person" | "teller";
  content: string;
  parts?: MessagePart[];
  usage?: Usage | null;
}): Promise<string> {
  const db = sql();
  const [row] = await db<{ id: string }[]>`
    insert into bank.messages (session_id, owner, role, content, parts, model, input_tokens, output_tokens, cost_usd)
    values (${input.sessionId}, ${input.owner}, ${input.role}, ${input.content},
            ${db.json((input.parts ?? []) as never)}, ${input.usage?.model ?? null},
            ${input.usage ? Math.round(input.usage.inputTokens) : null},
            ${input.usage ? Math.round(input.usage.outputTokens) : null},
            ${input.usage?.costUsd ?? null})
    returning id`;
  if (!row) throw new Error("The message was not saved");
  await db`update bank.sessions set updated_at = now() where owner = ${input.owner} and id = ${input.sessionId}`;
  return row.id;
}
