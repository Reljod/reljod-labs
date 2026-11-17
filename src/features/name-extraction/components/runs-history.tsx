"use client";

import type { RunSummary } from "../domain/contract";
import { modelLabel, usd } from "./format";
import { StatusTag } from "./timeline";
import { Button, cx, ErrorNote, Panel } from "./ui";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Past Runs with cost, names found and status; open one to see its result. */
export function RunsHistory({
  runs,
  error,
  openId,
  onOpen,
  onRefresh,
}: {
  runs: RunSummary[] | null;
  error: string | null;
  openId: string | null;
  onOpen: (run: RunSummary) => void;
  onRefresh: () => void;
}) {
  return (
    <Panel
      eyebrow="Runs"
      title={runs ? `${runs.length} runs` : "Runs"}
      actions={
        <Button size="sm" variant="ghost" onClick={onRefresh}>
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
      <div className="sv-scroll overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left">
            <tr className="eyebrow text-[0.62rem] text-ink-muted">
              <th className="px-4 py-2 font-medium">Document</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Started</th>
              <th className="px-2 py-2 font-medium">Models</th>
              <th className="px-2 py-2 text-right font-medium">Names found</th>
              <th className="px-2 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs === null && !error ? (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-ink-muted">
                  Loading…
                </td>
              </tr>
            ) : null}
            {runs?.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-ink-muted">
                  No runs yet. Open a document above and run Sieve on it.
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
                    {run.pages} pages ·{" "}
                    {run.source.kind === "corpus" ? "demo document" : "upload"}{" "}
                    · rules v{run.rulebookVersion}
                  </p>
                </td>
                <td className="px-2 py-2">
                  <StatusTag status={run.status} stoppedBy={run.stoppedBy} />
                </td>
                <td className="px-2 py-2 font-mono text-xs tabular-nums">
                  {WHEN.format(new Date(run.startedAt))}
                </td>
                <td className="px-2 py-2 text-xs">
                  {modelLabel(run.models.analyst)}
                  <span className="block text-ink-muted">
                    readers: {modelLabel(run.models.reader)}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">
                  {run.score
                    ? `${run.score.truePositives} of ${run.score.expected}`
                    : run.names}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">
                  {usd(run.costUsd)}
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
