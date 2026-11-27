import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { auditIn } from "../audit";
import { type Db, isUuid, sql } from "../db";
import { SourceChangedError } from "../errors";
import { toVector } from "../llm";
import type { KnowledgeRepository, SourceTextRow } from "../ports";
import {
  type HitRow,
  hitOf,
  loadConflicts,
  loadPassages,
  loadSource,
  loadSources,
  STALE_READING_MINUTES,
} from "./views";

/*
 * The Knowledge base's SQL (ADR 0016): `harness.sources`, `passages` and
 * `conflicts`. Every query names the Owner and leaves removed Sources out.
 * The rules (who may, the caps, what a Resolution does) are the Knowledge
 * service's; a write and its event share one transaction here.
 */

/** How many stale pending or long-removed Sources one sweep deletes; the rest wait for the next. */
export const STALE_BATCH = 20;
/** Days a removed Source is kept (hidden) before it is purged with its Passages and file. */
export const REMOVED_SOURCE_DAYS = 30;

/**
 * Sources registered long ago whose file never came (one attached in a
 * Session is kept for a month: it may be read again when the Session is
 * reopened), and Sources removed more than `REMOVED_SOURCE_DAYS` ago, with
 * their Passages and Conflicts (by cascade). A batch of each, and each
 * delete is limited to its batch, so every row deleted has its file removed
 * by the caller (no orphaned files).
 */
async function sweep(db: Db, owner: Owner): Promise<string[]> {
  const rows = await db<{ storage_path: string | null }[]>`
    with stale as (
      delete from harness.sources
      where owner = ${owner} and id in (
        select id from harness.sources
        where owner = ${owner} and status = 'pending' and not is_seed
          and deleted_at is null
          and created_at < now() - case when session_id is null
            then interval '1 day' else interval '30 days' end
        order by created_at
        limit ${STALE_BATCH}
      )
      returning storage_path
    ), purged as (
      delete from harness.sources
      where owner = ${owner} and id in (
        select id from harness.sources
        where owner = ${owner} and deleted_at is not null
          and deleted_at < now() - make_interval(days => ${REMOVED_SOURCE_DAYS})
        order by deleted_at
        limit ${STALE_BATCH}
      )
      returning storage_path
    )
    select storage_path from stale union all select storage_path from purged`;
  return rows.flatMap((row) => (row.storage_path ? [row.storage_path] : []));
}

/** Still ours, under lock? A removed or taken-over Source is left alone. */
async function lockReading(tx: Db, owner: Owner, sourceId: string) {
  const [mine] = await tx<{ id: string; session_id: string | null }[]>`
    select id, session_id from harness.sources
    where id = ${sourceId} and owner = ${owner} and status = 'reading'
      and deleted_at is null
    for update`;
  return mine ?? null;
}

export const knowledgeRepository: KnowledgeRepository = {
  async clearStale(owner) {
    await sql()`
      update harness.sources
      set status = 'failed', error = 'Reading was interrupted. Try again.'
      where owner = ${owner} and status = 'reading' and not is_seed and deleted_at is null
        and reading_at < now() - make_interval(mins => ${STALE_READING_MINUTES + 2})`;
  },

  sources: (owner) => loadSources(sql(), owner),
  source: (owner, sourceId) => loadSource(sql(), owner, sourceId),
  passages: (owner, sourceId) => loadPassages(sql(), owner, sourceId),

  async textRow(owner, sourceId) {
    if (!isUuid(sourceId)) return null;
    const [row] = await sql()<SourceTextRow[]>`
      select id, title, kind, storage_path, extracted_text
      from harness.sources where id = ${sourceId} and owner = ${owner}
        and deleted_at is null`;
    return row ?? null;
  },

  async count(owner) {
    const [row] = await sql()<{ n: number }[]>`
      select count(*)::int as n from harness.sources
      where owner = ${owner} and deleted_at is null`;
    return row?.n ?? 0;
  },

  sweep: (owner) => sweep(sql(), owner),

  async insert(owner, source) {
    await sql()`
      insert into harness.sources (
        id, owner, title, kind, storage_path, bytes, status, added_by,
        session_id, document_date, extracted_text
      ) values (
        ${source.id}, ${owner}, ${source.title}, ${source.kind},
        ${source.storagePath}, ${source.bytes}, 'pending', ${source.addedBy},
        ${source.sessionId}, ${source.documentDate}, ${source.text}
      )`;
  },

  async dropPending(owner, sourceId) {
    await sql()`
      delete from harness.sources
      where id = ${sourceId} and owner = ${owner} and status = 'pending'`;
  },

  async claim(owner, sourceId, maxReads) {
    if (!isUuid(sourceId)) return null;
    const [row] = await sql()<
      (SourceTextRow & { document_date: string | null })[]
    >`
      update harness.sources
      set status = 'reading', error = null, reading_at = now(),
          read_attempts = read_attempts + 1
      where id = ${sourceId} and owner = ${owner} and not is_seed
        and deleted_at is null
        and read_attempts < ${maxReads}
        and (
          status in ('pending', 'failed')
          or (status = 'reading'
              and reading_at < now() - make_interval(mins => ${STALE_READING_MINUTES}))
        )
      returning id, title, kind, storage_path, extracted_text,
                to_char(document_date, 'YYYY-MM-DD') as document_date`;
    return row ?? null;
  },

  async fail(owner, sourceId, message) {
    await sql()`
      update harness.sources set status = 'failed', error = ${message}
      where id = ${sourceId} and owner = ${owner} and status = 'reading'`;
  },

  async savePassages({ owner, sourceId, passages, vectors, documentDate }) {
    return sql().begin(async (tx) => {
      if (!(await lockReading(tx, owner, sourceId)))
        throw new SourceChangedError();
      // A retry starts from nothing: its old Passages (and their Conflicts) go.
      await tx`delete from harness.passages where source_id = ${sourceId}`;
      const rows = await tx<
        { id: number; ordinal: number; heading: string | null; body: string }[]
      >`
        insert into harness.passages ${tx(
          passages.map((passage, ordinal) => ({
            source_id: sourceId,
            owner,
            ordinal,
            heading: passage.heading,
            body: passage.body,
          })),
        )}
        returning id, ordinal, heading, body`;
      const embedded = vectors.flatMap((vector, ordinal) =>
        vector ? [[String(ordinal), toVector(vector)]] : [],
      );
      if (embedded.length > 0) {
        await tx`
          update harness.passages p set embedding = v.embedding::extensions.vector
          from (values ${tx(embedded)}) as v(ordinal, embedding)
          where p.source_id = ${sourceId} and p.ordinal = v.ordinal::int`;
      }
      if (documentDate) {
        await tx`
          update harness.sources set document_date = ${documentDate}
          where id = ${sourceId} and document_date is null`;
      }
      return rows.map((row) => ({ ...row, id: Number(row.id) }));
    });
  },

  async file({ owner, sourceId, found, event, conflictEvent }) {
    return sql().begin(async (tx) => {
      const mine = await lockReading(tx, owner, sourceId);
      if (!mine) throw new SourceChangedError();
      const saved: { id: string; found: (typeof found)[number] }[] = [];
      for (const conflict of found) {
        const [row] = await tx<{ id: string }[]>`
          insert into harness.conflicts (
            owner, new_passage_id, old_passage_id, summary, proposal, reasoning
          ) values (
            ${owner}, ${conflict.newPassageId}, ${conflict.oldPassageId},
            ${conflict.summary}, ${conflict.proposal}, ${conflict.reasoning}
          )
          on conflict (new_passage_id, old_passage_id) do nothing
          returning id`;
        if (row) saved.push({ id: row.id, found: conflict });
      }
      await tx`
        update harness.sources set status = 'ready', error = null
        where id = ${sourceId} and owner = ${owner}`;
      await auditIn(tx, event(mine.session_id, saved.length));
      for (const conflict of saved) {
        await auditIn(
          tx,
          conflictEvent(mine.session_id, conflict.id, conflict.found),
        );
      }
      return saved.map((conflict) => conflict.id);
    });
  },

  async remove({ owner, sourceId, check, event }) {
    if (!isUuid(sourceId)) {
      check(null);
      return;
    }
    await sql().begin(async (tx) => {
      const [row] = await tx<
        {
          id: string;
          title: string;
          is_seed: boolean;
          kind: string;
          session_id: string | null;
        }[]
      >`
        select id, title, is_seed, kind, session_id
        from harness.sources
        where id = ${sourceId} and owner = ${owner} and deleted_at is null
        for update`;
      check(row ? { isSeed: row.is_seed } : null);
      if (!row) return;
      await tx`
        update harness.sources set deleted_at = now()
        where id = ${row.id} and owner = ${owner} and deleted_at is null`;
      // Passages it superseded lost their replacement: they stand again.
      const restored = await tx<{ id: number }[]>`
        update harness.passages set superseded_by = null, superseded_at = null
        where owner = ${owner} and superseded_by in (
          select id from harness.passages
          where owner = ${owner} and source_id = ${row.id}
        )
        returning id`;
      await auditIn(
        tx,
        event(
          {
            id: row.id,
            title: row.title,
            kind: row.kind,
            sessionId: row.session_id,
          },
          restored.length,
        ),
      );
    });
  },

  conflicts: (owner, filter = {}) =>
    loadConflicts(sql(), owner, {
      ...filter,
      status: filter.status ?? null,
    }),

  async settle({ owner, conflictId, decidedBy, resolution, plan }) {
    return sql().begin(async (tx) => {
      const [row] = isUuid(conflictId)
        ? await tx<
            {
              id: string;
              status: "open" | "resolved";
              new_passage_id: number;
              old_passage_id: number;
            }[]
          >`
            select c.id, c.status, c.new_passage_id, c.old_passage_id
            from harness.conflicts c
            where c.id = ${conflictId} and c.owner = ${owner}
              -- A Conflict on a removed Source is gone with it.
              and not exists (
                select 1 from harness.passages p
                join harness.sources s on s.id = p.source_id
                where p.id in (c.new_passage_id, c.old_passage_id)
                  and s.deleted_at is not null
              )
            for update of c`
        : [];
      const decided = plan(
        row
          ? {
              status: row.status,
              newPassageId: Number(row.new_passage_id),
              oldPassageId: Number(row.old_passage_id),
            }
          : null,
      );
      if (!row) throw new Error("A missing Conflict was not refused.");
      const claimed = await tx<{ id: string }[]>`
        update harness.conflicts
        set status = 'resolved', resolution = ${resolution},
            decided_by = ${decidedBy}, decided_at = now()
        where id = ${row.id} and status = 'open'
        returning id`;
      if (claimed.length === 0) return false;
      if (decided.supersede) {
        await tx`
          update harness.passages
          set superseded_by = ${decided.supersede.by}, superseded_at = now()
          where id = ${decided.supersede.passageId} and owner = ${owner}
            and superseded_by is null`;
      }
      await auditIn(tx, decided.event);
      return true;
    });
  },

  async search(owner, text, vector, count) {
    const rows = await sql()<HitRow[]>`
      select * from harness.search_passages(
        ${owner}, ${text}, ${vector ? toVector(vector) : null}::extensions.vector, ${count})`;
    return rows.map(hitOf);
  },

  async hasUnembedded(owner) {
    const [row] = await sql()<{ found: boolean }[]>`
      select exists (
        select 1 from harness.passages p
        join harness.sources s on s.id = p.source_id
        where p.owner = ${owner} and p.embedding is null and s.deleted_at is null
      ) as found`;
    return row?.found ?? false;
  },

  async unembedded(owner, limit) {
    return sql()<{ id: number; heading: string | null; body: string }[]>`
      select p.id, p.heading, p.body
      from harness.passages p
      join harness.sources s on s.id = p.source_id
      where p.owner = ${owner} and p.embedding is null and s.status = 'ready'
        and s.deleted_at is null
      order by p.id
      limit ${limit}`;
  },

  async setEmbeddings(rows) {
    if (rows.length === 0) return;
    const db = sql();
    const values = rows.map((row) => [String(row.id), toVector(row.embedding)]);
    await db`
      update harness.passages p set embedding = v.embedding::extensions.vector
      from (values ${db(values)}) as v(id, embedding)
      where p.id = v.id::bigint and p.embedding is null`;
  },
};
