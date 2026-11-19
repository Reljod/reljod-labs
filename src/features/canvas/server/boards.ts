import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { LIMITS } from "../domain/limits";
import type { ViewRecord } from "../domain/payload";
import type { Caller } from "./caller";
import { type Db, isUuid, sql } from "./db";
import { InvalidError, LimitError, NotFoundError, StateError } from "./errors";
import { takeRate } from "./rate";
import { boardRefresh, boardSchedule } from "./refresh-workflow";
import { trail, trailIn } from "./trail";
import { getView, type RefreshChange } from "./views";

/*
 * Boards (GLOSSARY): Views a person pinned, arranged and named. A Board
 * belongs to its Owner, so everyone on the same Host account or Guest pass
 * sees it; that is what sharing means here. A Refresh runs every View's
 * Query again as a durable Workflow, with no model.
 */

export type BoardSummary = {
  id: string;
  name: string;
  views: number;
  scheduleMinutes: number | null;
  scheduleLeft: number;
  updatedAt: string;
};

export type BoardItem = { view: ViewRecord; position: number; span: 1 | 2 };

export type Refresh = {
  id: string;
  boardId: string;
  status: "queued" | "running" | "completed" | "failed";
  trigger: "manual" | "schedule";
  report: RefreshChange[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type Board = BoardSummary & {
  items: BoardItem[];
  refreshes: Refresh[];
};

type BoardRow = {
  id: string;
  name: string;
  views: number;
  schedule_minutes: number | null;
  schedule_left: number;
  updated_at: Date;
};

const summaryOf = (row: BoardRow): BoardSummary => ({
  id: row.id,
  name: row.name,
  views: row.views,
  scheduleMinutes: row.schedule_minutes,
  scheduleLeft: row.schedule_left,
  updatedAt: row.updated_at.toISOString(),
});

type RefreshRow = {
  id: string;
  board_id: string;
  status: Refresh["status"];
  trigger: Refresh["trigger"];
  report: RefreshChange[];
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
};

const refreshOf = (row: RefreshRow): Refresh => ({
  id: row.id,
  boardId: row.board_id,
  status: row.status,
  trigger: row.trigger,
  report: row.report ?? [],
  error: row.error,
  createdAt: row.created_at.toISOString(),
  finishedAt: row.finished_at?.toISOString() ?? null,
});

const nameOf = (value: unknown) => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name.length < 1 || name.length > 80)
    throw new InvalidError("A Board's name is 1 to 80 characters.");
  return name;
};

async function owned(db: Db, caller: Pick<Caller, "owner">, id: string) {
  if (!isUuid(id)) throw new NotFoundError("No such Board.");
  const [row] = await db<BoardRow[]>`
    select b.id, b.name, b.schedule_minutes, b.schedule_left, b.updated_at,
           (select count(*)::int from canvas.board_items i where i.board_id = b.id) as views
    from canvas.boards b
    where b.id = ${id} and b.owner = ${caller.owner}`;
  if (!row) throw new NotFoundError("No such Board.");
  return row;
}

export async function listBoards(
  caller: Pick<Caller, "owner">,
): Promise<BoardSummary[]> {
  const rows = await sql()<BoardRow[]>`
    select b.id, b.name, b.schedule_minutes, b.schedule_left, b.updated_at,
           (select count(*)::int from canvas.board_items i where i.board_id = b.id) as views
    from canvas.boards b
    where b.owner = ${caller.owner}
    order by b.updated_at desc
    limit ${LIMITS.boardsPerOwner}`;
  return rows.map(summaryOf);
}

export async function getBoard(
  caller: Pick<Caller, "owner">,
  id: string,
): Promise<Board> {
  const db = sql();
  const row = await owned(db, caller, id);
  const [items, refreshes] = await Promise.all([
    db<{ view_id: string; position: number; span: 1 | 2 }[]>`
      select view_id, position, span from canvas.board_items
      where board_id = ${row.id} and owner = ${caller.owner}
      order by position`,
    db<RefreshRow[]>`
      select id, board_id, status, trigger, report, error, created_at, finished_at
      from canvas.refreshes
      where board_id = ${row.id} and owner = ${caller.owner}
      order by created_at desc
      limit 5`,
  ]);
  const views = await Promise.all(
    items.map((item) => getView(caller, item.view_id)),
  );
  return {
    ...summaryOf(row),
    items: items.map((item, index) => ({
      view: views[index],
      position: item.position,
      span: item.span,
    })),
    refreshes: refreshes.map(refreshOf),
  };
}

export async function createBoard(
  caller: Caller,
  input: { name: unknown; viewIds?: string[] },
): Promise<BoardSummary> {
  const name = nameOf(input.name);
  const viewIds = [...new Set(input.viewIds ?? [])].slice(0, LIMITS.viewsPerBoard);
  // Each must be the Owner's; getView throws otherwise.
  await Promise.all(viewIds.map((id) => getView(caller, id)));
  return sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`canvas:boards:${caller.owner}`}, 0))`;
    const [count] = await tx<{ n: number }[]>`
      select count(*)::int as n from canvas.boards where owner = ${caller.owner}`;
    if ((count?.n ?? 0) >= LIMITS.boardsPerOwner)
      throw new LimitError(
        `You can keep ${LIMITS.boardsPerOwner} Boards. Delete one first.`,
      );
    const [row] = await tx<BoardRow[]>`
      insert into canvas.boards (owner, name) values (${caller.owner}, ${name})
      returning id, name, schedule_minutes, schedule_left, updated_at, 0 as views`;
    for (const [position, viewId] of viewIds.entries())
      await tx`
        insert into canvas.board_items (board_id, view_id, owner, position)
        values (${row.id}, ${viewId}, ${caller.owner}, ${position})`;
    await trailIn(tx, caller, {
      action: "board.created",
      summary: `Made Board "${name}"${viewIds.length > 0 ? ` with ${viewIds.length} View${viewIds.length === 1 ? "" : "s"}` : ""}`,
      boardId: row.id,
      detail: { name, views: viewIds },
    });
    return summaryOf({ ...row, views: viewIds.length });
  });
}

export async function renameBoard(caller: Caller, id: string, value: unknown) {
  const name = nameOf(value);
  return sql().begin(async (tx) => {
    const row = await owned(tx, caller, id);
    await tx`
      update canvas.boards set name = ${name}, updated_at = now()
      where id = ${row.id} and owner = ${caller.owner}`;
    await trailIn(tx, caller, {
      action: "board.renamed",
      summary: `Renamed Board "${row.name}" to "${name}"`,
      boardId: row.id,
      detail: { from: row.name, to: name },
    });
    return summaryOf({ ...row, name });
  });
}

/** Deletes a Board. Its Views stay; a sleeping Schedule finds no row and ends. */
export async function deleteBoard(caller: Caller, id: string) {
  await sql().begin(async (tx) => {
    const row = await owned(tx, caller, id);
    await tx`delete from canvas.boards where id = ${row.id} and owner = ${caller.owner}`;
    await trailIn(tx, caller, {
      action: "board.deleted",
      summary: `Deleted Board "${row.name}"`,
      boardId: row.id,
      detail: { name: row.name, views: row.views },
    });
  });
}

export async function pinView(caller: Caller, boardId: string, viewId: string) {
  const view = await getView(caller, viewId);
  await sql().begin(async (tx) => {
    const row = await owned(tx, caller, boardId);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`canvas:board:${row.id}`}, 0))`;
    const [state] = await tx<{ n: number; next: number; has: boolean }[]>`
      select count(*)::int as n, coalesce(max(position) + 1, 0)::int as next,
             coalesce(bool_or(view_id = ${view.id}), false) as has
      from canvas.board_items where board_id = ${row.id}`;
    if (state?.has) return;
    if ((state?.n ?? 0) >= LIMITS.viewsPerBoard)
      throw new LimitError(
        `A Board holds at most ${LIMITS.viewsPerBoard} Views.`,
      );
    await tx`
      insert into canvas.board_items (board_id, view_id, owner, position)
      values (${row.id}, ${view.id}, ${caller.owner}, ${state?.next ?? 0})`;
    await tx`update canvas.boards set updated_at = now() where id = ${row.id}`;
    await trailIn(tx, caller, {
      action: "board.pinned",
      summary: `Pinned "${view.spec.title}" to "${row.name}"`,
      boardId: row.id,
      viewId: view.id,
      detail: { board: row.name, view: view.spec.title },
    });
  });
}

export async function unpinView(caller: Caller, boardId: string, viewId: string) {
  await sql().begin(async (tx) => {
    const row = await owned(tx, caller, boardId);
    const removed = isUuid(viewId)
      ? await tx`
          delete from canvas.board_items
          where board_id = ${row.id} and view_id = ${viewId} and owner = ${caller.owner}
          returning view_id`
      : [];
    if (removed.length === 0) return;
    await tx`update canvas.boards set updated_at = now() where id = ${row.id}`;
    await trailIn(tx, caller, {
      action: "board.unpinned",
      summary: `Took a View off "${row.name}"`,
      boardId: row.id,
      viewId,
      detail: { board: row.name },
    });
  });
}

/** Sets the order and the width of a Board's Views. Views not named keep their place after the named ones. */
export async function arrangeBoard(
  caller: Caller,
  boardId: string,
  items: { viewId: string; span?: number }[],
) {
  await sql().begin(async (tx) => {
    const row = await owned(tx, caller, boardId);
    const current = await tx<{ view_id: string; span: number }[]>`
      select view_id, span from canvas.board_items
      where board_id = ${row.id} order by position`;
    const known = new Map(current.map((item) => [item.view_id, item.span]));
    const ordered = [
      ...items.filter((item) => known.has(item.viewId)),
      ...current
        .filter((item) => !items.some((given) => given.viewId === item.view_id))
        .map((item) => ({ viewId: item.view_id, span: item.span })),
    ];
    for (const [position, item] of ordered.entries())
      await tx`
        update canvas.board_items
        set position = ${position}, span = ${item.span === 2 ? 2 : (item.span === 1 ? 1 : (known.get(item.viewId) ?? 1))}
        where board_id = ${row.id} and view_id = ${item.viewId}`;
    await tx`update canvas.boards set updated_at = now() where id = ${row.id}`;
    await trailIn(tx, caller, {
      action: "board.arranged",
      summary: `Arranged "${row.name}"`,
      boardId: row.id,
      detail: { order: ordered.map((item) => item.viewId) },
    });
  });
}

// Refresh ------------------------------------------------------------------------------------

const refreshInput = (caller: Caller, boardId: string) => ({
  owner: caller.owner,
  visitor: caller.visitor,
  boardId,
});

/** Starts a Refresh of a Board as a durable Workflow and returns at once. */
export async function startRefresh(
  caller: Caller,
  boardId: string,
): Promise<Refresh> {
  const db = sql();
  const board = await owned(db, caller, boardId);
  if (board.views === 0)
    throw new StateError("Pin a View to this Board before refreshing it.");
  const [busy] = await db<{ id: string }[]>`
    select id from canvas.refreshes
    where board_id = ${board.id} and owner = ${caller.owner}
      and status in ('queued', 'running')
      and created_at > now() - interval '10 minutes'
    limit 1`;
  if (busy) throw new StateError("This Board is already being refreshed.");
  await takeRate(caller.visitor, caller.owner, "refresh");
  const [row] = await db<RefreshRow[]>`
    insert into canvas.refreshes (owner, board_id, status, trigger)
    values (${caller.owner}, ${board.id}, 'queued', 'manual')
    returning id, board_id, status, trigger, report, error, created_at, finished_at`;
  try {
    const run = await start(boardRefresh, [
      refreshInput(caller, board.id),
      row.id,
    ]);
    await db`
      update canvas.refreshes set workflow_run_id = ${run.runId}
      where id = ${row.id} and owner = ${caller.owner}`;
  } catch (error) {
    await db`
      update canvas.refreshes
      set status = 'failed', finished_at = now(), error = 'The Refresh could not be started.'
      where id = ${row.id} and owner = ${caller.owner}`;
    console.error("[canvas] refresh start failed", error);
    throw new StateError("The Refresh could not be started. Try again.");
  }
  return refreshOf(row);
}

export async function getRefresh(
  caller: Pick<Caller, "owner">,
  id: string,
): Promise<Refresh> {
  if (!isUuid(id)) throw new NotFoundError("No such Refresh.");
  const [row] = await sql()<RefreshRow[]>`
    select id, board_id, status, trigger, report, error, created_at, finished_at
    from canvas.refreshes
    where id = ${id} and owner = ${caller.owner}`;
  if (!row) throw new NotFoundError("No such Refresh.");
  return refreshOf(row);
}

/**
 * Sets or clears a Board's Schedule. A new Schedule gets a new id and its own
 * sleeping workflow; the old workflow wakes, finds another id on the row and
 * ends without refreshing.
 */
export async function setSchedule(
  caller: Caller,
  boardId: string,
  minutes: number | null,
): Promise<BoardSummary> {
  const db = sql();
  const board = await owned(db, caller, boardId);
  if (minutes !== null) {
    if (
      !Number.isInteger(minutes) ||
      minutes < LIMITS.scheduleMinMinutes ||
      minutes > 7 * 24 * 60
    )
      throw new InvalidError(
        `A Schedule runs every ${LIMITS.scheduleMinMinutes} minutes to 7 days.`,
      );
    await takeRate(caller.visitor, caller.owner, "refresh");
  }
  const scheduleId = minutes === null ? null : randomUUID();
  const left = minutes === null ? 0 : LIMITS.scheduleRuns;
  await db.begin(async (tx) => {
    await tx`
      update canvas.boards
      set schedule_minutes = ${minutes}, schedule_id = ${scheduleId},
          schedule_left = ${left}, updated_at = now()
      where id = ${board.id} and owner = ${caller.owner}`;
    await trailIn(tx, caller, {
      action: "board.scheduled",
      summary:
        minutes === null
          ? `Cleared the Schedule of "${board.name}"`
          : `"${board.name}" refreshes every ${minutes} minutes, ${left} times`,
      boardId: board.id,
      detail: { minutes, runs: left },
    });
  });
  if (scheduleId && minutes !== null) {
    try {
      await start(boardSchedule, [
        refreshInput(caller, board.id),
        scheduleId,
        minutes,
      ]);
    } catch (error) {
      console.error("[canvas] schedule start failed", error);
      await db`
        update canvas.boards
        set schedule_minutes = null, schedule_id = null, schedule_left = 0
        where id = ${board.id} and owner = ${caller.owner} and schedule_id = ${scheduleId}`;
      throw new StateError("The Schedule could not be started. Try again.");
    }
  }
  return summaryOf({
    ...board,
    schedule_minutes: minutes,
    schedule_left: left,
  });
}

/** Records that a Board was exported; the file itself is built by the export route. */
export async function recordExport(
  caller: Caller,
  boardId: string,
  format: "html" | "pdf",
) {
  const board = await owned(sql(), caller, boardId);
  await trail(caller, {
    action: "board.exported",
    summary: `Exported "${board.name}" as ${format.toUpperCase()}`,
    boardId: board.id,
    detail: { format, views: board.views },
  });
  return board;
}
