import "server-only";
import { type Db, db, jsonb } from "@/server/postgres";
import { isUuid } from "../domain/ids";
import type { ViewWork } from "../domain/payload";
import type { CheckFinding } from "../domain/rules";
import type { Verification } from "../domain/verify";
import type { ParamValues, QueryResult, ViewSpec } from "../domain/view";
import type { Guarded, StoredView, ViewRepository, ViewValues } from "./ports";
import { iso, trailIn } from "./trail";

type Row = {
  id: string;
  conversation_id: string | null;
  spec: ViewSpec;
  params: ParamValues;
  result: QueryResult;
  verification: Verification;
  findings: CheckFinding[];
  status: "verified" | "flagged";
  rulebook_version: number;
  work: ViewWork;
  guarded: Guarded;
  revision: number;
  created_at: string;
  updated_at: string;
};

const storedOf = (row: Row): StoredView => ({
  id: row.id,
  conversationId: row.conversation_id,
  revision: row.revision,
  spec: row.spec,
  params: row.params,
  result: row.result,
  verification: row.verification,
  findings: row.findings,
  status: row.status,
  rulebookVersion: row.rulebook_version,
  work: row.work,
  guarded: row.guarded,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/** The columns a computed View writes. */
function valuesOf(tx: Db, values: Partial<ViewValues>) {
  const out: Record<string, unknown> = {};
  if (values.spec) out.spec = jsonb(tx, values.spec);
  if (values.params) out.params = jsonb(tx, values.params);
  if (values.result) out.result = jsonb(tx, values.result);
  if (values.verification) out.verification = jsonb(tx, values.verification);
  if (values.findings) out.findings = jsonb(tx, values.findings);
  if (values.status) out.status = values.status;
  if (values.rulebookVersion !== undefined)
    out.rulebook_version = values.rulebookVersion;
  if (values.work) out.work = jsonb(tx, values.work);
  if (values.guarded) out.guarded = jsonb(tx, values.guarded);
  return out;
}

/** Views in Postgres; every read is scoped to the Owner and skips soft-deleted rows. */
export const viewRepository: ViewRepository = {
  async get(owner, id) {
    if (!isUuid(id)) return null;
    const sql = db();
    const [row] = await sql<Row[]>`
      select * from canvas.views
      where id = ${id} and owner = ${owner} and deleted_at is null`;
    return row ? storedOf(row) : null;
  },

  async list(owner, conversationId, limit) {
    // A Conversation named by something that is not an id holds nothing.
    if (conversationId !== undefined && !isUuid(conversationId)) return [];
    const sql = db();
    const rows = conversationId
      ? await sql<Row[]>`
          select v.* from canvas.views v
          join canvas.conversations c
            on c.id = v.conversation_id and c.owner = ${owner} and c.deleted_at is null
          where v.owner = ${owner} and v.conversation_id = ${conversationId}
            and v.deleted_at is null
          order by v.created_at
          limit ${limit}`
      : await sql<Row[]>`
          select * from canvas.views
          where owner = ${owner} and deleted_at is null
          order by created_at desc
          limit ${limit}`;
    return rows.map(storedOf);
  },

  async countInConversation(owner, conversationId) {
    if (!isUuid(conversationId)) return 0;
    const [row] = await db()<{ n: number }[]>`
      select count(*)::int as n from canvas.views
      where owner = ${owner} and conversation_id = ${conversationId}
        and deleted_at is null`;
    return row?.n ?? 0;
  },

  async neighbours(owner, view, limit) {
    const sql = db();
    const rows = await sql<Row[]>`
      select v.* from canvas.views v
      where v.owner = ${owner} and v.id <> ${view.id} and v.deleted_at is null
        and (
          (v.conversation_id is not null and v.conversation_id = ${view.conversationId}
            and exists (
              select 1 from canvas.conversations c
              where c.id = v.conversation_id and c.deleted_at is null))
          or exists (
            select 1 from canvas.board_items a
            join canvas.board_items b on b.board_id = a.board_id
            where a.view_id = ${view.id} and b.view_id = v.id
          )
        )
      order by v.created_at
      limit ${limit}`;
    return rows.map(storedOf);
  },

  async insert(caller, values, event) {
    return db().begin(async (tx) => {
      const row = {
        owner: caller.owner,
        conversation_id: isUuid(caller.conversationId)
          ? caller.conversationId
          : null,
        ...valuesOf(tx, values),
      };
      const [saved] = await tx<Row[]>`
        insert into canvas.views ${tx(row)}
        returning *`;
      await trailIn(tx, caller, event(saved.id));
      return storedOf(saved);
    });
  },

  async update(caller, id, values, event) {
    if (!isUuid(id)) return null;
    return db().begin(async (tx) => {
      const [saved] = await tx<Row[]>`
        update canvas.views set ${tx(valuesOf(tx, values))},
          revision = revision + 1, updated_at = now()
        where id = ${id} and owner = ${caller.owner} and deleted_at is null
        returning *`;
      if (!saved) return null;
      await trailIn(tx, caller, event);
      return storedOf(saved);
    });
  },
};
