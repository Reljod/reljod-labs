/** Who a Run by hand is compared with. Pure. */
import { isOver, type RunSummary } from "../domain/contract";

/**
 * The Operator's Run of the same Task to put beside a Run by hand: the
 * Owner's latest finished one, else the recorded Run shipped with the site.
 * `runs` is newest first.
 */
export function operatorRunFor(
  taskId: string | null,
  runs: readonly RunSummary[],
  recorded: RunSummary | null,
): RunSummary | null {
  if (!taskId) return null;
  const own = runs.find(
    (run) =>
      run.driver === "operator" &&
      run.taskId === taskId &&
      isOver(run.status) &&
      run.verdict !== null,
  );
  if (own) return own;
  return recorded && recorded.taskId === taskId ? recorded : null;
}

/** How many times as long the slower side took: `2.4`. Null when either time is missing. */
export function timesSlower(ms: number, otherMs: number) {
  if (!(ms > 0) || !(otherMs > 0)) return null;
  const ratio = Math.max(ms, otherMs) / Math.min(ms, otherMs);
  return Math.round(ratio * 10) / 10;
}
