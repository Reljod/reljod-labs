import "server-only";
import type {
  ConversationSummary,
  Message,
  MessagePart,
  MessageUsage,
} from "../domain/chat";
import { titleOf } from "../domain/chat";
import { LIMITS } from "../domain/limits";
import type { Caller } from "./caller";
import { isUuid, jsonb, sql } from "./db";
import { LimitError, NotFoundError } from "./errors";
import { trailIn } from "./trail";

type MessageRow = {
  id: string;
  role: "person" | "analyst";
  content: string;
  parts: MessagePart[];
  usage: Omit<MessageUsage, "type"> | null;
  created_at: Date;
};

const messageOf = (row: MessageRow): Message => ({
  id: row.id,
  role: row.role,
  content: row.content,
  parts: row.parts ?? [],
  usage: row.usage,
  createdAt: row.created_at.toISOString(),
});

export async function listConversations(
  caller: Pick<Caller, "owner">,
): Promise<ConversationSummary[]> {
  const rows = await sql()<
    { id: string; title: string; views: number; updated_at: Date }[]
  >`
    select c.id, c.title, c.updated_at,
           (select count(*)::int from canvas.views v where v.conversation_id = c.id) as views
    from canvas.conversations c
    where c.owner = ${caller.owner}
    order by c.updated_at desc
    limit ${LIMITS.conversationsPerOwner}`;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    views: row.views,
    updatedAt: row.updated_at.toISOString(),
  }));
}

/** The Conversation's messages, oldest first. Throws when it is not the Owner's. */
export async function conversationMessages(
  caller: Pick<Caller, "owner">,
  id: string,
): Promise<Message[]> {
  if (!isUuid(id)) throw new NotFoundError("No such Conversation.");
  const db = sql();
  const [found] = await db`
    select 1 from canvas.conversations where id = ${id} and owner = ${caller.owner}`;
  if (!found) throw new NotFoundError("No such Conversation.");
  const rows = await db<MessageRow[]>`
    select id, role, content, parts, usage, created_at
    from canvas.messages
    where conversation_id = ${id} and owner = ${caller.owner}
    order by created_at
    limit 200`;
  return rows.map(messageOf);
}

/**
 * Files a Question: in the Conversation given, or in a new one titled after
 * it. Returns the ids the turn's Runs and Views are filed under.
 */
export async function fileQuestion(
  caller: Caller,
  input: { conversationId?: string; text: string },
) {
  return sql().begin(async (tx) => {
    let conversationId = input.conversationId;
    let title = titleOf(input.text);
    let started = false;
    if (isUuid(conversationId)) {
      const [row] = await tx<{ title: string }[]>`
        update canvas.conversations set updated_at = now()
        where id = ${conversationId} and owner = ${caller.owner}
        returning title`;
      if (!row) throw new NotFoundError("No such Conversation.");
      title = row.title;
    } else {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`canvas:conversations:${caller.owner}`}, 0))`;
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from canvas.conversations where owner = ${caller.owner}`;
      if ((count?.n ?? 0) >= LIMITS.conversationsPerOwner)
        throw new LimitError(
          `You can keep ${LIMITS.conversationsPerOwner} Conversations. Delete one first.`,
        );
      const [row] = await tx<{ id: string }[]>`
        insert into canvas.conversations (owner, title)
        values (${caller.owner}, ${title})
        returning id`;
      conversationId = row.id;
      started = true;
    }
    const [message] = await tx<{ id: string }[]>`
      insert into canvas.messages (owner, conversation_id, role, content)
      values (${caller.owner}, ${conversationId as string}, 'person', ${input.text})
      returning id`;
    const filed: Caller = {
      ...caller,
      conversationId: conversationId as string,
      questionId: message.id,
    };
    if (started)
      await trailIn(tx, filed, {
        action: "conversation.started",
        summary: `Conversation started: ${title}`,
        detail: { title },
      });
    await trailIn(tx, filed, {
      action: "question.asked",
      summary: input.text.replace(/\s+/g, " ").slice(0, 200),
      detail: { text: input.text },
    });
    return { conversationId: conversationId as string, questionId: message.id, title };
  });
}

/** Saves the Analyst's answer to a Question. */
export async function fileAnswer(
  caller: Caller,
  input: {
    content: string;
    parts: MessagePart[];
    usage: Omit<MessageUsage, "type"> | null;
  },
): Promise<string | null> {
  if (!isUuid(caller.conversationId)) return null;
  const db = sql();
  const [row] = await db<{ id: string }[]>`
    insert into canvas.messages (owner, conversation_id, role, content, parts, usage)
    values (
      ${caller.owner}, ${caller.conversationId}, 'analyst', ${input.content},
      ${jsonb(db, input.parts)}, ${input.usage ? jsonb(db, input.usage) : null}
    )
    returning id`;
  await db`
    update canvas.conversations set updated_at = now()
    where id = ${caller.conversationId} and owner = ${caller.owner}`;
  return row?.id ?? null;
}

/** Sandbox time a Question has used, for its usage line. */
export async function questionSandboxMs(caller: Caller) {
  if (!isUuid(caller.questionId)) return 0;
  const [row] = await sql()<{ sandbox_ms: number }[]>`
    select sandbox_ms from canvas.messages
    where id = ${caller.questionId} and owner = ${caller.owner}`;
  return row?.sandbox_ms ?? 0;
}

/**
 * Deletes a Conversation, its messages and its Views. A View pinned to a
 * Board stays, without its Conversation.
 */
export async function deleteConversation(caller: Caller, id: string) {
  if (!isUuid(id)) throw new NotFoundError("No such Conversation.");
  await sql().begin(async (tx) => {
    const [row] = await tx<{ title: string }[]>`
      select title from canvas.conversations
      where id = ${id} and owner = ${caller.owner}`;
    if (!row) throw new NotFoundError("No such Conversation.");
    await tx`
      delete from canvas.views v
      where v.conversation_id = ${id} and v.owner = ${caller.owner}
        and not exists (select 1 from canvas.board_items i where i.view_id = v.id)`;
    await tx`delete from canvas.conversations where id = ${id} and owner = ${caller.owner}`;
    await trailIn(tx, caller, {
      action: "conversation.deleted",
      summary: `Deleted Conversation "${row.title}"`,
      detail: { conversationId: id, title: row.title },
    });
  });
}
