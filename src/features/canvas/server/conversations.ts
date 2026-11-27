import "server-only";
import { db, jsonb } from "@/server/postgres";
import type { Message, MessagePart, MessageUsage } from "../domain/chat";
import { isUuid } from "../domain/ids";
import type { Caller, ConversationRepository } from "./ports";
import { iso, trailIn } from "./trail";

type MessageRow = {
  id: string;
  role: "person" | "analyst";
  content: string;
  parts: MessagePart[];
  usage: Omit<MessageUsage, "type"> | null;
  created_at: string;
};

const messageOf = (row: MessageRow): Message => ({
  id: row.id,
  role: row.role,
  content: row.content,
  parts: row.parts ?? [],
  usage: row.usage,
  createdAt: iso(row.created_at),
});

/** Conversations and their messages in Postgres, every statement scoped to the Owner. */
export const conversationRepository: ConversationRepository = {
  async list(owner, limit) {
    const rows = await db()<
      { id: string; title: string; views: number; updated_at: string }[]
    >`
      select c.id, c.title, c.updated_at, coalesce(v.n, 0)::int as views
      from canvas.conversations c
      left join lateral (
        select count(*) as n from canvas.views v
        where v.conversation_id = c.id and v.deleted_at is null
      ) v on true
      where c.owner = ${owner} and c.deleted_at is null
      order by c.updated_at desc
      limit ${limit}`;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      views: row.views,
      updatedAt: iso(row.updated_at),
    }));
  },

  async exists(owner, id) {
    if (!isUuid(id)) return false;
    const [found] = await db()`
      select 1 from canvas.conversations
      where id = ${id} and owner = ${owner} and deleted_at is null`;
    return Boolean(found);
  },

  async messages(owner, id) {
    if (!isUuid(id)) return [];
    const rows = await db()<MessageRow[]>`
      select id, role, content, parts, usage, created_at
      from canvas.messages
      where conversation_id = ${id} and owner = ${owner}
      order by created_at
      limit 200`;
    return rows.map(messageOf);
  },

  async fileQuestion(caller, input, admitNew, events) {
    return db().begin(async (tx) => {
      let conversationId = input.conversationId;
      let title = input.title;
      let started = false;
      if (conversationId !== undefined) {
        if (!isUuid(conversationId)) return null;
        const [row] = await tx<{ title: string }[]>`
          update canvas.conversations set updated_at = now()
          where id = ${conversationId} and owner = ${caller.owner} and deleted_at is null
          returning title`;
        if (!row) return null;
        title = row.title;
      } else {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`canvas:conversations:${caller.owner}`}, 0))`;
        const [count] = await tx<{ n: number }[]>`
          select count(*)::int as n from canvas.conversations
          where owner = ${caller.owner} and deleted_at is null`;
        admitNew(count?.n ?? 0);
        const [row] = await tx<{ id: string }[]>`
          insert into canvas.conversations (owner, title)
          values (${caller.owner}, ${title})
          returning id`;
        conversationId = row.id;
        started = true;
      }
      const [message] = await tx<{ id: string }[]>`
        insert into canvas.messages (owner, conversation_id, role, content)
        values (${caller.owner}, ${conversationId}, 'person', ${input.text})
        returning id`;
      const filed: Caller = {
        ...caller,
        conversationId,
        questionId: message.id,
      };
      const out = { conversationId, questionId: message.id, title };
      for (const event of events(out, started)) await trailIn(tx, filed, event);
      return out;
    });
  },

  async fileAnswer(caller, answer) {
    if (!isUuid(caller.conversationId)) return null;
    // One statement: the message and the Conversation's new time together.
    const sql = db();
    const [row] = await sql<{ id: string }[]>`
      with touched as (
        update canvas.conversations set updated_at = now()
        where id = ${caller.conversationId} and owner = ${caller.owner}
      )
      insert into canvas.messages (owner, conversation_id, role, content, parts, usage)
      values (
        ${caller.owner}, ${caller.conversationId}, 'analyst', ${answer.content},
        ${jsonb(sql, answer.parts)}, ${answer.usage ? jsonb(sql, answer.usage) : null}
      )
      returning id`;
    return row?.id ?? null;
  },

  async sandboxMs(owner, questionId) {
    if (!isUuid(questionId)) return 0;
    const [row] = await db()<{ sandbox_ms: number }[]>`
      select sandbox_ms from canvas.messages
      where id = ${questionId} and owner = ${owner}`;
    return row?.sandbox_ms ?? 0;
  },

  async spendSandbox(owner, questionId, ms) {
    if (!isUuid(questionId)) return;
    await db()`
      update canvas.messages set sandbox_ms = sandbox_ms + ${Math.round(ms)}
      where id = ${questionId} and owner = ${owner}`;
  },

  async softDelete(caller, id, event) {
    if (!isUuid(id)) return false;
    return db().begin(async (tx) => {
      const [row] = await tx<{ title: string }[]>`
        select title from canvas.conversations
        where id = ${id} and owner = ${caller.owner} and deleted_at is null
        for update`;
      if (!row) return false;
      await tx`
        update canvas.views v set deleted_at = now()
        where v.conversation_id = ${id} and v.owner = ${caller.owner}
          and v.deleted_at is null
          and not exists (select 1 from canvas.board_items i where i.view_id = v.id)`;
      await tx`
        update canvas.conversations set deleted_at = now()
        where id = ${id} and owner = ${caller.owner}`;
      await trailIn(tx, caller, event(row.title));
      return true;
    });
  },
};
