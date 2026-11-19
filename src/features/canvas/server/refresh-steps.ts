import type { Owner } from "@/features/access/domain/owner";
import type { Caller } from "./caller";
import { jsonb, sql } from "./db";
import type { Visitor } from "./rate";
import { trail } from "./trail";
import { type RefreshChange, refreshView } from "./views";

/*
 * The steps of a Board Refresh (`refresh-workflow.ts`). Everything that
 * touches the database or the Sandbox is a step; no step calls a model. The
 * function names are the workflow's replay keys: do not rename or move them
 * while a Schedule is sleeping (conventions.md).
 */

export type RefreshInput = {
  owner: Owner;
  visitor: Visitor;
  boardId: string;
};

const callerOf = (input: RefreshInput): Caller => ({
  owner: input.owner,
  visitor: input.visitor,
  actor: "system",
});

/** Marks the Refresh running and lists the Board's Views, in Board order. Empty when the Refresh is gone. */
export async function beginRefresh(
  input: RefreshInput,
  refreshId: string,
): Promise<string[]> {
  "use step";
  const db = sql();
  const moved = await db`
    update canvas.refreshes set status = 'running'
    where id = ${refreshId} and owner = ${input.owner} and status = 'queued'
    returning id`;
  if (moved.length === 0) return [];
  const rows = await db<{ view_id: string }[]>`
    select view_id from canvas.board_items
    where board_id = ${input.boardId} and owner = ${input.owner}
    order by position`;
  await trail(callerOf(input), {
    action: "refresh.started",
    summary: `Refreshing ${rows.length} View${rows.length === 1 ? "" : "s"}`,
    boardId: input.boardId,
    detail: { refreshId, views: rows.length, model: null },
  });
  return rows.map((row) => row.view_id);
}

/** Runs one View's Query again and says what changed. A View deleted meanwhile is reported, not thrown. */
export async function refreshOneView(
  input: RefreshInput,
  refreshId: string,
  viewId: string,
): Promise<RefreshChange> {
  "use step";
  let change: RefreshChange;
  try {
    change = await refreshView(callerOf(input), viewId);
  } catch (error) {
    change = {
      viewId,
      title: "View",
      ok: false,
      changes: [],
      error:
        error instanceof Error && error.name !== "Error"
          ? error.message
          : "The View could not be refreshed.",
      statusBefore: "flagged",
      statusAfter: null,
      rowsBefore: 0,
      rowsAfter: null,
      ms: 0,
    };
  }
  // Written as it goes, so the Board shows progress View by View.
  await sql()`
    update canvas.refreshes
    set report = report || ${jsonb(sql(), [change])}
    where id = ${refreshId} and owner = ${input.owner}`;
  return change;
}

export async function finishRefresh(
  input: RefreshInput,
  refreshId: string,
  report: RefreshChange[],
) {
  "use step";
  const failed = report.filter((item) => !item.ok).length;
  const changed = report.filter((item) => item.changes.length > 0).length;
  await sql()`
    update canvas.refreshes
    set status = 'completed', finished_at = now(), report = ${jsonb(sql(), report)}
    where id = ${refreshId} and owner = ${input.owner}`;
  await sql()`
    update canvas.boards set updated_at = now()
    where id = ${input.boardId} and owner = ${input.owner}`;
  await trail(callerOf(input), {
    action: "refresh.finished",
    summary: `Refreshed ${report.length} View${report.length === 1 ? "" : "s"}: ${changed} changed, ${failed} failed`,
    boardId: input.boardId,
    detail: {
      refreshId,
      views: report.length,
      changed,
      failed,
      report: report.map((item) => ({
        viewId: item.viewId,
        ok: item.ok,
        changes: item.changes,
        error: item.error,
      })),
      model: null,
    },
  });
}

export async function failRefresh(
  input: RefreshInput,
  refreshId: string,
  message: string,
) {
  "use step";
  await sql()`
    update canvas.refreshes
    set status = 'failed', finished_at = now(), error = ${message.slice(0, 400)}
    where id = ${refreshId} and owner = ${input.owner} and status in ('queued', 'running')`;
  await trail(callerOf(input), {
    action: "refresh.finished",
    summary: `Refresh failed: ${message}`.slice(0, 280),
    boardId: input.boardId,
    detail: { refreshId, ok: false },
  });
}

/**
 * A Schedule woke up. Acts only if the Board still carries this Schedule
 * (the row may have been deleted, or the Schedule replaced or cleared, while
 * the workflow slept) and it has firings left; takes one and queues a
 * Refresh. Returns its id, or null to end the Schedule.
 */
export async function claimScheduledRefresh(
  input: RefreshInput,
  scheduleId: string,
): Promise<string | null> {
  "use step";
  return sql().begin(async (tx) => {
    const [board] = await tx<{ id: string }[]>`
      update canvas.boards
      set schedule_left = schedule_left - 1
      where id = ${input.boardId} and owner = ${input.owner}
        and schedule_id = ${scheduleId} and schedule_left > 0
      returning id`;
    if (!board) return null;
    const [refresh] = await tx<{ id: string }[]>`
      insert into canvas.refreshes (owner, board_id, status, trigger)
      values (${input.owner}, ${input.boardId}, 'queued', 'schedule')
      returning id`;
    return refresh?.id ?? null;
  });
}

/** Clears a Schedule that has used its firings, if it is still the Board's. */
export async function endSchedule(input: RefreshInput, scheduleId: string) {
  "use step";
  await sql()`
    update canvas.boards
    set schedule_minutes = null, schedule_id = null, schedule_left = 0
    where id = ${input.boardId} and owner = ${input.owner}
      and schedule_id = ${scheduleId} and schedule_left = 0`;
}
