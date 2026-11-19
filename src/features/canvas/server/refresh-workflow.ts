import { sleep } from "workflow";
import {
  beginRefresh,
  claimScheduledRefresh,
  endSchedule,
  failRefresh,
  finishRefresh,
  type RefreshInput,
  refreshOneView,
} from "./refresh-steps";
import type { RefreshChange } from "./views";

/*
 * A Board Refresh on the Workflow SDK (ADR 0032): each View's Query runs
 * again as its own durable step, so a Refresh survives a restart and a slow
 * Sandbox, and the Board shows it View by View. No model is called anywhere
 * in it. A Schedule is the same work behind a durable `sleep`.
 */

async function refreshAll(input: RefreshInput, refreshId: string) {
  try {
    const viewIds = await beginRefresh(input, refreshId);
    const report: RefreshChange[] = [];
    // One at a time: the Views share one Sandbox and one Sandbox-time budget.
    for (const viewId of viewIds)
      report.push(await refreshOneView(input, refreshId, viewId));
    await finishRefresh(input, refreshId, report);
    return report.length;
  } catch (error) {
    await failRefresh(
      input,
      refreshId,
      error instanceof Error ? error.message : "The Refresh failed.",
    );
    return 0;
  }
}

/** One Refresh of a Board, started by a person or a tool. */
export async function boardRefresh(input: RefreshInput, refreshId: string) {
  "use workflow";
  const views = await refreshAll(input, refreshId);
  return { refreshId, views };
}

/**
 * A Board's Schedule: sleeps, refreshes, and sleeps again until its firings
 * are used up or the Board no longer carries this Schedule. The check after
 * every sleep is the point: the row may have changed while it slept.
 */
export async function boardSchedule(
  input: RefreshInput,
  scheduleId: string,
  minutes: number,
) {
  "use workflow";
  let fired = 0;
  for (;;) {
    await sleep(`${minutes}m`);
    const refreshId = await claimScheduledRefresh(input, scheduleId);
    if (!refreshId) break;
    await refreshAll(input, refreshId);
    fired++;
  }
  await endSchedule(input, scheduleId);
  return { scheduleId, fired };
}
