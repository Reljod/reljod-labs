import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  type Attachment,
  attachmentList,
  isSourceId,
  MAX_ATTACHMENT_NOTES,
  resolveSourceRef,
} from "../domain/attachments";
import type { SourceKind, SourceStatus } from "../domain/knowledge";
import { isUuid, sql } from "./db";
import { InvalidError } from "./errors";

/*
 * The Sources attached in one Session, read from the database: the ones
 * uploaded in it (`session_id`) and the ones its Staff messages carry as
 * attachments (a Source attached from the Knowledge base keeps its own
 * `session_id`). Scoped by the Owner and the Session, never wider.
 */

type Row = {
  id: string;
  title: string;
  kind: SourceKind;
  status: SourceStatus;
  storage_path: string | null;
};

/** The file name a stored Source ends in (`…/penhallow-leaving-cayman.md`). */
const fileNameOf = (path: string | null): string | null =>
  path ? (path.split("/").pop() ?? null) : null;

/** A Session's attached Sources, filed or not, newest first, at most `limit`. */
export async function sessionAttachments(
  owner: Owner,
  sessionId: string,
  limit = MAX_ATTACHMENT_NOTES * 3,
): Promise<Attachment[]> {
  if (!isUuid(sessionId)) return [];
  const rows = await sql()<Row[]>`
    select s.id, s.title, s.kind, s.status, s.storage_path
    from harness.sources s
    where s.owner = ${owner}
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
    limit ${limit}`;
  return rows.map((row) => ({
    sourceId: row.id,
    title: row.title,
    fileName: fileNameOf(row.storage_path),
    kind: row.kind,
    status: row.status,
  }));
}

/**
 * The Source id a tool was given. A UUID passes through (the tool checks it
 * is the Owner's). Anything else is looked up among this Session's
 * attachments by file name or title, and used only when exactly one fits.
 * Without a Session (an outside MCP client) only ids resolve. Throws an
 * InvalidError that lists the attachments, so the model can correct itself.
 */
export async function resolveSourceId(
  caller: { owner: Owner; sessionId: string | null },
  ref: string,
): Promise<string> {
  if (isSourceId(ref)) return ref.trim().toLowerCase();
  const attachments = caller.sessionId
    ? await sessionAttachments(caller.owner, caller.sessionId)
    : [];
  const result = resolveSourceRef(ref, attachments);
  if (!result.ok) {
    throw new InvalidError(
      caller.sessionId
        ? result.message
        : `"${ref.slice(0, 80)}" is not a Source id. Give the id (a UUID) from list_sources.`,
    );
  }
  return result.sourceId;
}

/** `resolveSourceId` for a list; duplicates are dropped. */
export async function resolveSourceIds(
  caller: { owner: Owner; sessionId: string | null },
  refs: readonly string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const ref of refs) ids.push(await resolveSourceId(caller, ref));
  return [...new Set(ids)];
}

/** A hint appended to a "not found" for a Session's attachments, so a wrong id can be corrected in one step. */
export async function attachmentsHint(caller: {
  owner: Owner;
  sessionId: string | null;
}): Promise<string> {
  if (!caller.sessionId) return "";
  const attachments = await sessionAttachments(caller.owner, caller.sessionId);
  if (attachments.length === 0) return "";
  return ` Attached in this Session:\n${attachmentList(attachments)}`;
}
