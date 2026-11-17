import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  ConflictSide,
  ConflictView,
  Passage,
  PassageHit,
  Resolution,
  SourceKind,
  SourceStatus,
  SourceView,
} from "../../domain/knowledge";
import { type Db, isUuid } from "../db";

/** Reads of the Knowledge base's tables and how a row becomes what the API answers. Every read takes the Owner. */

// Sources ------------------------------------------------------------------------

type SourceRow = {
  id: string;
  title: string;
  kind: SourceKind;
  bytes: number;
  is_seed: boolean;
  status: SourceStatus;
  error: string | null;
  added_by: string | null;
  added_by_name: string | null;
  session_id: string | null;
  document_date: string | null;
  passages: number;
  open_conflicts: number;
  created_at: Date;
};

const sourceOf = (row: SourceRow): SourceView => ({
  id: row.id,
  title: row.title,
  kind: row.kind,
  bytes: Number(row.bytes),
  isSeed: row.is_seed,
  status: row.status,
  error: row.error,
  addedBy:
    row.added_by && row.added_by_name
      ? { id: row.added_by, name: row.added_by_name }
      : null,
  sessionId: row.session_id,
  documentDate: row.document_date,
  passages: row.passages,
  openConflicts: row.open_conflicts,
  createdAt: row.created_at.toISOString(),
});

/** A read for longer than this is a read that died: it is failed so it can be tried again. */
export const STALE_READING_MINUTES = 3;

/** The Owner's Sources, newest first and seed Sources after; or just one, by id. */
export async function loadSources(
  db: Db,
  owner: Owner,
  id?: string,
): Promise<SourceView[]> {
  if (id !== undefined && !isUuid(id)) return [];
  const rows = await db<SourceRow[]>`
    select s.id, s.title, s.kind, s.bytes, s.is_seed, s.status, s.error,
           s.added_by, st.name as added_by_name, s.session_id,
           to_char(s.document_date, 'YYYY-MM-DD') as document_date,
           (select count(*)::int from harness.passages p
             where p.source_id = s.id) as passages,
           (select count(distinct c.id)::int
              from harness.conflicts c
              join harness.passages p
                on p.id in (c.new_passage_id, c.old_passage_id)
             where p.source_id = s.id and c.status = 'open') as open_conflicts,
           s.created_at
    from harness.sources s
    left join harness.staff st on st.id = s.added_by
    where s.owner = ${owner}
      ${id !== undefined ? db`and s.id = ${id}` : db``}
    order by s.is_seed, s.created_at desc, s.title`;
  return rows.map(sourceOf);
}

export async function loadSource(
  db: Db,
  owner: Owner,
  id: string,
): Promise<SourceView | null> {
  return (await loadSources(db, owner, id))[0] ?? null;
}

// Passages -----------------------------------------------------------------------

type PassageRow = {
  id: number;
  source_id: string;
  ordinal: number;
  heading: string | null;
  body: string;
  superseded_by: number | null;
  superseded_at: Date | null;
};

export async function loadPassages(
  db: Db,
  owner: Owner,
  sourceId: string,
): Promise<Passage[]> {
  if (!isUuid(sourceId)) return [];
  const rows = await db<PassageRow[]>`
    select id, source_id, ordinal, heading, body, superseded_by, superseded_at
    from harness.passages
    where owner = ${owner} and source_id = ${sourceId}
    order by ordinal`;
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    ordinal: row.ordinal,
    heading: row.heading,
    body: row.body,
    supersededBy: row.superseded_by,
    supersededAt: row.superseded_at ? row.superseded_at.toISOString() : null,
  }));
}

export type HitRow = {
  passage_id: number;
  source_id: string;
  source_title: string;
  source_kind: SourceKind;
  document_date: Date | string | null;
  ordinal: number;
  heading: string | null;
  body: string;
  score: number;
  semantic: number | null;
  lexical: number | null;
  conflict_open: boolean;
};

const dateOnly = (value: Date | string | null): string | null => {
  if (value === null) return null;
  // postgres.js reads a `date` as a Date at UTC midnight.
  return typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
};

export const hitOf = (row: HitRow): PassageHit => ({
  passageId: Number(row.passage_id),
  sourceId: row.source_id,
  sourceTitle: row.source_title,
  sourceKind: row.source_kind,
  documentDate: dateOnly(row.document_date),
  ordinal: row.ordinal,
  heading: row.heading,
  body: row.body,
  score: Number(row.score),
  semantic: row.semantic === null ? null : Number(row.semantic),
  lexical: row.lexical === null ? null : Number(row.lexical),
  conflictOpen: row.conflict_open,
});

// Conflicts ----------------------------------------------------------------------

type ConflictRow = {
  id: string;
  summary: string;
  proposal: Resolution;
  reasoning: string | null;
  status: "open" | "resolved";
  resolution: Resolution | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  created_at: Date;
  n_id: number;
  n_source: string;
  n_title: string;
  n_date: string | null;
  n_heading: string | null;
  n_body: string;
  o_id: number;
  o_source: string;
  o_title: string;
  o_date: string | null;
  o_heading: string | null;
  o_body: string;
};

const sideOf = (
  passage: [number, string, string, string | null, string | null, string],
): ConflictSide => ({
  passageId: Number(passage[0]),
  sourceId: passage[1],
  sourceTitle: passage[2],
  documentDate: passage[3],
  heading: passage[4],
  body: passage[5],
});

const conflictOf = (row: ConflictRow): ConflictView => ({
  id: row.id,
  newPassage: sideOf([
    row.n_id,
    row.n_source,
    row.n_title,
    row.n_date,
    row.n_heading,
    row.n_body,
  ]),
  oldPassage: sideOf([
    row.o_id,
    row.o_source,
    row.o_title,
    row.o_date,
    row.o_heading,
    row.o_body,
  ]),
  summary: row.summary,
  proposal: row.proposal,
  reasoning: row.reasoning,
  status: row.status,
  resolution: row.resolution,
  decidedBy:
    row.decided_by && row.decided_by_name
      ? { id: row.decided_by, name: row.decided_by_name }
      : null,
  decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
});

/** The Owner's Conflicts, open first then newest; or one by id; or those that touch one Source. */
export async function loadConflicts(
  db: Db,
  owner: Owner,
  filter: {
    id?: string;
    status?: "open" | "resolved" | null;
    sourceId?: string;
  } = {},
): Promise<ConflictView[]> {
  if (filter.id !== undefined && !isUuid(filter.id)) return [];
  if (filter.sourceId !== undefined && !isUuid(filter.sourceId)) return [];
  const rows = await db<ConflictRow[]>`
    select c.id, c.summary, c.proposal, c.reasoning, c.status, c.resolution,
           c.decided_by, st.name as decided_by_name, c.decided_at, c.created_at,
           np.id as n_id, np.source_id as n_source, ns.title as n_title,
           to_char(ns.document_date, 'YYYY-MM-DD') as n_date,
           np.heading as n_heading, np.body as n_body,
           op.id as o_id, op.source_id as o_source, os.title as o_title,
           to_char(os.document_date, 'YYYY-MM-DD') as o_date,
           op.heading as o_heading, op.body as o_body
    from harness.conflicts c
    join harness.passages np on np.id = c.new_passage_id
    join harness.sources ns on ns.id = np.source_id
    join harness.passages op on op.id = c.old_passage_id
    join harness.sources os on os.id = op.source_id
    left join harness.staff st on st.id = c.decided_by
    where c.owner = ${owner}
      ${filter.id !== undefined ? db`and c.id = ${filter.id}` : db``}
      ${filter.status ? db`and c.status = ${filter.status}` : db``}
      ${
        filter.sourceId !== undefined
          ? db`and (np.source_id = ${filter.sourceId} or op.source_id = ${filter.sourceId})`
          : db``
      }
    order by (c.status = 'open') desc, c.created_at desc, c.id`;
  return rows.map(conflictOf);
}
