"use client";

import type { RunSummary } from "../domain/contract";
import { VerdictTag } from "./checklist";
import { DRIVER_LABEL, duration, modelLabel, STATUS_WORD, usd } from "./format";
import { isOver } from "./run-view";
import { Button, cx, ErrorNote, Panel, Spinner, Tag } from "./ui";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** The Owner's Runs: who drove, the Task, the Verdict, time, cost and errors. Open one to replay it. */
export function RunsHistory({
  runs,
  error,
  busy,
  openId,
  onOpen,
  onRefresh,
}: {
  runs: RunSummary[] | null;
  error: string | null;
  /** A refresh is in flight: the list stays up, marked busy. */
  busy: boolean;
  openId: string | null;
  onOpen: (run: RunSummary) => void;
  onRefresh: () => void;
}) {
  return (
    <Panel
      eyebrow="Your Runs"
      title={runs ? `${runs.length} Runs` : "Runs"}
      actions={
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh}>
          {busy ? <Spinner className="size-3" /> : null}
          Refresh
        </Button>
      }
      bodyClassName=""
    >
      {error ? (
        <div className="px-4 py-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      <div className="op-scroll overflow-x-auto" aria-busy={busy || undefined}>
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="text-left">
            <tr className="eyebrow text-[0.62rem] text-ink-muted">
              <th className="px-4 py-2 font-medium">Task</th>
              <th className="px-2 py-2 font-medium">Driver</th>
              <th className="px-2 py-2 font-medium">Verdict</th>
              <th className="px-2 py-2 font-medium">Started</th>
              <th className="px-2 py-2 text-right font-medium">Time</th>
              <th className="px-2 py-2 text-right font-medium">Cost</th>
              <th className="px-2 py-2 text-right font-medium">Errors</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs === null && !error ? (
              <tr>
                <td colSpan={8} className="px-4 py-3 text-ink-muted">
                  Loading…
                </td>
              </tr>
            ) : null}
            {runs?.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-3 text-ink-muted">
                  No Runs yet. Pick a Task above, or take the keyboard.
                </td>
              </tr>
            ) : null}
            {runs?.map((run) => (
              <tr
                key={run.id}
                className={cx(
                  "border-ink/10 border-t",
                  run.id === openId && "bg-morning-haze/50",
                )}
              >
                <td className="px-4 py-2">
                  <p className="font-semibold">{run.title}</p>
                  <p className="font-mono text-[0.68rem] text-ink-muted">
                    {run.taskId ? "sample Task" : "own Task"}
                    {run.manifestName ? ` · ${run.manifestName}` : ""} · Rules v
                    {run.rulebookVersion}
                  </p>
                </td>
                <td className="px-2 py-2 text-xs">
                  {DRIVER_LABEL[run.driver]}
                  {run.driver === "operator" ? (
                    <span className="block text-ink-muted">
                      {modelLabel(run.model)}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-2">
                  {isOver(run.status) ? (
                    <VerdictTag verdict={run.verdict} />
                  ) : (
                    <Tag tone={run.status === "paused" ? "red" : "blue"}>
                      {STATUS_WORD[run.status]}
                    </Tag>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-xs tabular-nums">
                  {WHEN.format(new Date(run.startedAt))}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">
                  {run.metrics.ms > 0 ? duration(run.metrics.ms) : "…"}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">
                  {run.driver === "operator" ? usd(run.costUsd) : "none"}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">
                  {run.metrics.errors}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    size="sm"
                    variant={run.id === openId ? "ghost" : "secondary"}
                    disabled={run.id === openId}
                    onClick={() => onOpen(run)}
                  >
                    {run.id === openId ? "Opened" : "Open"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
