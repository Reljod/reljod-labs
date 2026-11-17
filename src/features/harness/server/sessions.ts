import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditUsage } from "../domain/audit";
import { LIMITS } from "../domain/limits";
import { can } from "../domain/permissions";
import {
  type MessagePart,
  type MessageRole,
  type MessageView,
  NEW_SESSION_TITLE,
  SESSION_TITLE_CHARS,
  type SessionStatus,
  type SessionSummary,
  titleFrom,
} from "../domain/session";
import type { Staff } from "../domain/staff";
import { auditIn } from "./audit";
import { isUuid, jsonb, sql } from "./db";
import {
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "./errors";
import { takeRate, type Visitor } from "./rate";

type SessionRow = {
  id: string;
  title: string;
  status: SessionStatus;
  staff_id: string;
  staff_name: string;
  staff_initials: string;
  preview: string | null;
  created_at: Date;
  updated_at: Date;
};

const PREVIEW_CHARS = 90;

const summaryOf = (row: SessionRow): SessionSummary => ({
  id: row.id,
  title: row.title,
  status: row.status,
  staff: {
    id: row.staff_id,
    name: row.staff_name,
    initials: row.staff_initials,
  },
  preview: (row.preview ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREVIEW_CHARS),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

function cleanTitle(raw: unknown): string {
  if (typeof raw !== "string")
    throw new InvalidError("Give the Session a title.");
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) throw new InvalidError("Give the Session a title.");
  if (title.length > SESSION_TITLE_CHARS) {
    throw new InvalidError(
      `A Session's title is at most ${SESSION_TITLE_CHARS} characters.`,
    );
  }
  return title;
}

/**
 * A Staff member's own Sessions, latest activity first. Sessions are not
 * shared between Staff: switching Staff shows that person's list.
 */
export async function listSessions(input: {
  owner: Owner;
  staff: Pick<Staff, "id">;
}): Promise<SessionSummary[]> {
  const rows = await sql()<SessionRow[]>`
    select s.id, s.title, s.status, s.staff_id, s.created_at, s.updated_at,
           st.name as staff_name, st.initials as staff_initials,
           (select left(m.content, 200) from harness.messages m
             where m.session_id = s.id
             order by m.created_at desc, m.id desc limit 1) as preview
    from harness.sessions s
    join harness.staff st on st.id = s.staff_id
    where s.owner = ${input.owner} and s.staff_id = ${input.staff.id}
    order by s.updated_at desc
    limit ${LIMITS.sessionsPerWorkspace}`;
  return rows.map(summaryOf);
}

/**
 * The Session, if it is in the Owner's Workspace; null otherwise. Scoped to
 * the Owner only: use `readableSession` or `writableSession` to also hold it
 * to the Staff member.
 */
export async function ownedSession(
  owner: Owner,
  sessionId: unknown,
): Promise<SessionSummary | null> {
  if (!isUuid(sessionId)) return null;
  const [row] = await sql()<SessionRow[]>`
    select s.id, s.title, s.status, s.staff_id, s.created_at, s.updated_at,
           st.name as staff_name, st.initials as staff_initials,
           null::text as preview
    from harness.sessions s
    join harness.staff st on st.id = s.staff_id
    where s.owner = ${owner} and s.id = ${sessionId}`;
  return row ? summaryOf(row) : null;
}

/**
 * The Session, if this Staff member may read it: their own, or any in the
 * Workspace for an admin (who reads the whole Workspace's Audit trail and so
 * may open the Session an event points at).
 */
export async function readableSession(
  input: { owner: Owner; staff: Pick<Staff, "id" | "role"> },
  sessionId: unknown,
): Promise<SessionSummary | null> {
  const session = await ownedSession(input.owner, sessionId);
  if (!session) return null;
  return session.staff.id === input.staff.id ||
    can(input.staff, "audit.read.workspace")
    ? session
    : null;
}

/**
 * The Session, if this Staff member may write in it: only their own. Throws
 * NotFoundError when it is not in the Workspace and ForbiddenError when it is
 * someone else's.
 */
export async function writableSession(
  input: { owner: Owner; staff: Pick<Staff, "id"> },
  sessionId: unknown,
): Promise<SessionSummary> {
  const session = await ownedSession(input.owner, sessionId);
  if (!session)
    throw new NotFoundError("That Session is not in this Workspace.");
  if (session.staff.id !== input.staff.id) {
    throw new ForbiddenError(
      `This Session belongs to ${session.staff.name}. Switch Staff to write in it.`,
    );
  }
  return session;
}

/** Opens a Session for the Staff member, up to `LIMITS.sessionsPerWorkspace`, and records it. */
export async function createSession(input: {
  owner: Owner;
  staff: Staff;
  title?: string | null;
}): Promise<SessionSummary> {
  if (!can(input.staff, "session.create")) {
    throw ForbiddenError.forAction("session.create");
  }
  const title = input.title ? cleanTitle(input.title) : NEW_SESSION_TITLE;
  const id = await sql().begin(async (tx) => {
    // Serialise this Workspace's opens, so two at once cannot both take the last place.
    await tx`select 1 from harness.workspaces where owner = ${input.owner} for update`;
    const [count] = await tx<{ sessions: number }[]>`
      select count(*)::int as sessions from harness.sessions
      where owner = ${input.owner}`;
    if ((count?.sessions ?? 0) >= LIMITS.sessionsPerWorkspace) {
      throw new LimitError(
        `A Workspace keeps ${LIMITS.sessionsPerWorkspace} Sessions. Carry on in one you have.`,
      );
    }
    const [row] = await tx<{ id: string }[]>`
      insert into harness.sessions (owner, staff_id, title)
      values (${input.owner}, ${input.staff.id}, ${title})
      returning id`;
    if (!row) throw new Error("Session was not created");
    await auditIn(tx, {
      owner: input.owner,
      sessionId: row.id,
      actor: { kind: "staff", staff: input.staff },
      action: "session.created",
      summary: "Opened a Session",
      target: { kind: "session", id: row.id },
    });
    return row.id;
  });
  const session = await ownedSession(input.owner, id);
  if (!session) throw new Error("Session was not created");
  return session;
}

/** Renames a Session of the Staff member's own, and records it. */
export async function renameSession(input: {
  owner: Owner;
  staff: Staff;
  sessionId: string;
  title: string;
}): Promise<SessionSummary> {
  const session = await writableSession(input, input.sessionId);
  const title = cleanTitle(input.title);
  if (title === session.title) return session;
  await sql().begin(async (tx) => {
    await tx`
      update harness.sessions set title = ${title}, updated_at = now()
      where owner = ${input.owner} and id = ${session.id}`;
    await auditIn(tx, {
      owner: input.owner,
      sessionId: session.id,
      actor: { kind: "staff", staff: input.staff },
      action: "session.renamed",
      summary: `Renamed the Session to "${title}"`,
      target: { kind: "session", id: session.id },
      detail: { from: session.title, to: title },
    });
  });
  return { ...session, title, updatedAt: new Date().toISOString() };
}

type MessageRow = {
  id: string;
  session_id: string;
  role: MessageRole;
  staff_id: string | null;
  staff_name: string | null;
  staff_initials: string | null;
  content: string;
  parts: MessagePart[] | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  created_at: Date;
};

const messageOf = (row: MessageRow): MessageView => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  staff:
    row.staff_id && row.staff_name
      ? {
          id: row.staff_id,
          name: row.staff_name,
          initials: row.staff_initials ?? "",
        }
      : null,
  content: row.content,
  parts: row.parts ?? [],
  usage: row.model
    ? {
        model: row.model,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      }
    : null,
  createdAt: row.created_at.toISOString(),
});

/** A Session's messages, oldest first. The caller has already checked the Session (`readableSession`). */
export async function listMessages(
  owner: Owner,
  sessionId: string,
): Promise<MessageView[]> {
  if (!isUuid(sessionId)) return [];
  const rows = await sql()<MessageRow[]>`
    select m.id, m.session_id, m.role, m.staff_id, m.content, m.parts,
           m.model, m.input_tokens, m.output_tokens, m.cost_usd, m.created_at,
           st.name as staff_name, st.initials as staff_initials
    from harness.messages m
    left join harness.staff st on st.id = m.staff_id
    where m.owner = ${owner} and m.session_id = ${sessionId}
    order by m.created_at, m.id`;
  return rows.map(messageOf);
}

export type AppendMessageInput = {
  owner: Owner;
  sessionId: string;
  content: string;
  parts?: MessagePart[];
} & (
  | {
      role: "staff";
      /** Who is writing; the Session must be theirs. */
      staff: Staff;
      /** Whose hourly allowance the message counts against. */
      visitor: Visitor;
    }
  | {
      role: "agent";
      /**
       * What the turn cost: saved on the message row. Not on its Audit
       * event: the chat records each model call's cost once, on
       * `model.called`, so the trail never counts a call twice.
       */
      usage: AuditUsage | null;
    }
);

/**
 * Adds a message to a Session and records it (`message.sent`), in one
 * transaction.
 *
 * A `staff` message is the paid entry point of a chat turn, so the caps are
 * here and not only in the route: the Session must be the Staff member's
 * own, the text at most `LIMITS.messageChars`, and it takes one of the
 * visitor's `LIMITS.messagesPerHour`. The first message names a Session
 * still called "New session". An `agent` message carries the turn's usage.
 */
export async function appendMessage(
  input: AppendMessageInput,
): Promise<{ message: MessageView; session: SessionSummary }> {
  const parts = input.parts ?? [];
  let session: SessionSummary;
  if (input.role === "staff") {
    session = await writableSession(input, input.sessionId);
    if (!input.content.trim() && parts.length === 0) {
      throw new InvalidError("Write a message first.");
    }
    if (input.content.length > LIMITS.messageChars) {
      throw new InvalidError(
        `A message is at most ${LIMITS.messageChars} characters.`,
      );
    }
    await takeRate(input.visitor, input.owner, "message");
  } else {
    const found = await ownedSession(input.owner, input.sessionId);
    if (!found)
      throw new NotFoundError("That Session is not in this Workspace.");
    session = found;
  }
  const staff = input.role === "staff" ? input.staff : null;
  const usage = input.role === "agent" ? input.usage : null;
  const title =
    staff && session.title === NEW_SESSION_TITLE && input.content.trim()
      ? titleFrom(input.content)
      : session.title;

  const row = await sql().begin(async (tx) => {
    const [inserted] = await tx<{ id: string; created_at: Date }[]>`
      insert into harness.messages (
        session_id, owner, role, staff_id, content, parts,
        model, input_tokens, output_tokens, cost_usd
      ) values (
        ${session.id}, ${input.owner}, ${input.role}, ${staff?.id ?? null},
        ${input.content}, ${jsonb(tx, parts)},
        ${usage?.model ?? null},
        ${usage ? Math.round(usage.inputTokens) : null},
        ${usage ? Math.round(usage.outputTokens) : null},
        ${usage?.costUsd ?? null}
      )
      returning id, created_at`;
    if (!inserted) throw new Error("Message was not saved");
    await tx`
      update harness.sessions set title = ${title}, updated_at = now()
      where owner = ${input.owner} and id = ${session.id}`;
    await auditIn(tx, {
      owner: input.owner,
      sessionId: session.id,
      actor: staff ? { kind: "staff", staff } : { kind: "agent" },
      action: "message.sent",
      summary: staff ? "Sent a message" : "Answered",
      target: { kind: "message", id: inserted.id },
      detail: {
        chars: input.content.length,
        parts: parts.map((part) => part.type),
      },
      // Cost and tokens live on `model.called` only (one event per call).
      usage: null,
    });
    return inserted;
  });

  const updatedAt = new Date().toISOString();
  return {
    message: {
      id: row.id,
      sessionId: session.id,
      role: input.role,
      staff: staff
        ? { id: staff.id, name: staff.name, initials: staff.initials }
        : null,
      content: input.content,
      parts,
      usage,
      createdAt: row.created_at.toISOString(),
    },
    session: {
      ...session,
      title,
      updatedAt,
      preview: input.content
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, PREVIEW_CHARS),
    },
  };
}
