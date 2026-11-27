import "server-only";
import { MAX_ATTACHMENT_NOTES } from "../domain/attachments";
import type { SourceKind, SourceStatus } from "../domain/knowledge";
import { LIMITS } from "../domain/limits";
import {
  type MessagePart,
  type MessageRole,
  type MessageView,
  SESSION_PREVIEW_CHARS,
  type SessionStatus,
  type SessionSummary,
} from "../domain/session";
import { auditIn } from "./audit";
import { isUuid, jsonb, sql } from "./db";
import type { SessionRepository } from "./ports";

/*
 * Sessions and their messages in `harness.sessions` and `harness.messages`.
 * Every query names the Owner. The checks (whose Session it is, the caps)
 * are the Sessions service's; a write and its Audit event share one
 * transaction here.
 */

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
    .slice(0, SESSION_PREVIEW_CHARS),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

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

type AttachmentRow = {
  id: string;
  title: string;
  kind: SourceKind;
  status: SourceStatus;
  storage_path: string | null;
};

/** The file name a stored Source ends in (`…/penhallow-leaving-cayman.md`). */
const fileNameOf = (path: string | null): string | null =>
  path ? (path.split("/").pop() ?? null) : null;

/** How many attached Sources a Session's list reads. */
const ATTACHMENTS_READ = MAX_ATTACHMENT_NOTES * 3;

export const sessionRepository: SessionRepository = {
  async list(owner, staffId) {
    const rows = await sql()<SessionRow[]>`
      select s.id, s.title, s.status, s.staff_id, s.created_at, s.updated_at,
             st.name as staff_name, st.initials as staff_initials,
             last.content as preview
      from harness.sessions s
      join harness.staff st on st.id = s.staff_id
      left join lateral (
        select left(m.content, 200) as content from harness.messages m
        where m.session_id = s.id
        order by m.created_at desc, m.id desc limit 1
      ) last on true
      where s.owner = ${owner} and s.staff_id = ${staffId}
      order by s.updated_at desc
      limit ${LIMITS.sessionsPerWorkspace}`;
    return rows.map(summaryOf);
  },

  async owned(owner, sessionId) {
    if (!isUuid(sessionId)) return null;
    const [row] = await sql()<SessionRow[]>`
      select s.id, s.title, s.status, s.staff_id, s.created_at, s.updated_at,
             st.name as staff_name, st.initials as staff_initials,
             null::text as preview
      from harness.sessions s
      join harness.staff st on st.id = s.staff_id
      where s.owner = ${owner} and s.id = ${sessionId}`;
    return row ? summaryOf(row) : null;
  },

  async create({ owner, staffId, title, max, event }) {
    return sql().begin(async (tx) => {
      // Serialise this Workspace's opens, so two at once cannot both take the last place.
      await tx`select 1 from harness.workspaces where owner = ${owner} for update`;
      const [count] = await tx<{ sessions: number }[]>`
        select count(*)::int as sessions from harness.sessions
        where owner = ${owner}`;
      if ((count?.sessions ?? 0) >= max) return null;
      const [row] = await tx<{ id: string }[]>`
        insert into harness.sessions (owner, staff_id, title)
        values (${owner}, ${staffId}, ${title})
        returning id`;
      if (!row) throw new Error("Session was not created");
      await auditIn(tx, event(row.id));
      return row.id;
    });
  },

  async rename(owner, sessionId, title, event) {
    await sql().begin(async (tx) => {
      await tx`
        update harness.sessions set title = ${title}, updated_at = now()
        where owner = ${owner} and id = ${sessionId}`;
      await auditIn(tx, event);
    });
  },

  async messages(owner, sessionId) {
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
  },

  async append({ owner, sessionId, title, message, event }) {
    const { usage, staff } = message;
    const row = await sql().begin(async (tx) => {
      const [inserted] = await tx<{ id: string; created_at: Date }[]>`
        insert into harness.messages (
          session_id, owner, role, staff_id, content, parts,
          model, input_tokens, output_tokens, cost_usd
        ) values (
          ${sessionId}, ${owner}, ${message.role}, ${staff?.id ?? null},
          ${message.content}, ${jsonb(tx, message.parts)},
          ${usage?.model ?? null},
          ${usage ? Math.round(usage.inputTokens) : null},
          ${usage ? Math.round(usage.outputTokens) : null},
          ${usage?.costUsd ?? null}
        )
        returning id, created_at`;
      if (!inserted) throw new Error("Message was not saved");
      await tx`
        update harness.sessions set title = ${title}, updated_at = now()
        where owner = ${owner} and id = ${sessionId}`;
      await auditIn(tx, event(inserted.id));
      return inserted;
    });
    return { id: row.id, createdAt: row.created_at.toISOString() };
  },

  /**
   * The Sources attached in one Session: uploaded in it (`session_id`), or
   * carried by its Staff messages (a Source attached from the Knowledge base
   * keeps its own `session_id`). Newest first.
   */
  async attachments(owner, sessionId) {
    if (!isUuid(sessionId)) return [];
    const rows = await sql()<AttachmentRow[]>`
      select s.id, s.title, s.kind, s.status, s.storage_path
      from harness.sources s
      where s.owner = ${owner} and s.deleted_at is null
        and (
          s.session_id = ${sessionId}
          or s.id in (
            select (part ->> 'sourceId')::uuid
            from harness.messages m,
                 jsonb_array_elements(m.parts) part
            where m.owner = ${owner}
              and m.session_id = ${sessionId}
              and part ->> 'type' = 'attachment'
              and part ->> 'sourceId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
        )
      order by s.created_at desc
      limit ${ATTACHMENTS_READ}`;
    return rows.map((row) => ({
      sourceId: row.id,
      title: row.title,
      fileName: fileNameOf(row.storage_path),
      kind: row.kind,
      status: row.status,
    }));
  },
};
