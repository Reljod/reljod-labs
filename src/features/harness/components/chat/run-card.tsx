"use client";

import { useQuery } from "@tanstack/react-query";
import type { PipelineId } from "../../domain/pipeline";
import { pipelineOf } from "../../domain/pipelines";
import { isRunActive, type RunView } from "../../domain/run";
import { api, keys } from "../api";
import { formatDuration, humanize } from "../pipelines/format";
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  runPulses,
} from "../pipelines/status";
import { Badge, Button, cx } from "../ui";

/** Steps finished (done or skipped) out of all of them. */
export function stepProgress(run: Pick<RunView, "steps">) {
  const total = run.steps.length;
  const finished = run.steps.filter(
    (step) => step.status === "done" || step.status === "skipped",
  ).length;
  return { total, finished };
}

/**
 * A Run the Agent started, in the chat: the Pipeline, where it stands and a
 * way into the Pipeline view. Polls the Run while it is at work (the Pipeline
 * tab holds the live stream; a card only needs the headline).
 */
export function RunCard({
  runId,
  pipelineId,
  onView,
}: {
  runId: string;
  pipelineId: PipelineId;
  onView: (runId: string) => void;
}) {
  const query = useQuery({
    queryKey: keys.run(runId),
    queryFn: () => api.runs.get(runId),
    refetchInterval: (state) =>
      state.state.data && !isRunActive(state.state.data.status) ? false : 2000,
    refetchIntervalInBackground: false,
  });
  const run = query.data;
  const title = pipelineOf(pipelineId)?.title ?? humanize(pipelineId);
  const progress = run ? stepProgress(run) : null;
  const fraction =
    progress && progress.total > 0 ? progress.finished / progress.total : 0;
  const elapsed = run
    ? Date.parse(run.finishedAt ?? run.updatedAt) - Date.parse(run.createdAt)
    : null;

  return (
    <section
      aria-label={`Run: ${title}`}
      className="outline-box rounded-sm bg-paper px-3 py-2.5 shadow-hard-md"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-bold uppercase">
            <span className="truncate">{title}</span>
            {run ? (
              <Badge
                tone={RUN_STATUS_TONE[run.status]}
                dot={runPulses(run.status)}
              >
                {RUN_STATUS_LABEL[run.status]}
              </Badge>
            ) : query.isError ? (
              <Badge tone="neutral">Status unavailable</Badge>
            ) : (
              <Badge tone="neutral">Starting</Badge>
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {run?.subject ? `${run.subject} · ` : ""}
            {progress && progress.total > 0
              ? `${progress.finished} of ${progress.total} Steps`
              : "Run started"}
            {elapsed !== null && elapsed >= 0
              ? ` · ${formatDuration(elapsed)}`
              : ""}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => onView(runId)}>
          View pipeline
        </Button>
      </div>
      {progress && progress.total > 0 ? (
        <div
          role="progressbar"
          aria-label="Steps finished"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.finished}
          className="mt-2 h-2 overflow-hidden rounded-sm border border-ink bg-marble"
        >
          <div
            className={cx(
              "h-full transition-[width] duration-300",
              run?.status === "failed"
                ? "bg-seal-red"
                : run?.status === "waiting_approval"
                  ? "bg-brass"
                  : "bg-federal-blue",
            )}
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      ) : null}
      {run?.status === "waiting_approval" ? (
        <p className="mt-2 text-xs text-oak">
          This Run is waiting for a person to give or return its Approval.
        </p>
      ) : null}
    </section>
  );
}
