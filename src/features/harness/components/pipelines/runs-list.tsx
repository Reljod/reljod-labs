"use client";

import type { PipelineSpec } from "../../domain/pipeline";
import { isRunActive, type RunStatus, type RunSummary } from "../../domain/run";
import { Badge, cx, Empty, ErrorNote, Loading } from "../ui";
import { humanize, timeAgo } from "./format";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, runPulses } from "./status";

export type RunFilter = "session" | "all";

/** The Pipelines of this Workspace, each a button that shows its shape. */
export function PipelineCatalogue({
  pipelines,
  selectedId,
  onSelect,
}: {
  pipelines: readonly PipelineSpec[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (pipelines.length === 0) {
    return (
      <Empty title="No Pipelines yet" className="py-6">
        They will be listed here with their Steps.
      </Empty>
    );
  }
  return (
    <ul className="space-y-1">
      {pipelines.map((pipeline) => (
        <li key={pipeline.id}>
          <button
            type="button"
            aria-pressed={selectedId === pipeline.id}
            onClick={() => onSelect(pipeline.id)}
            className={cx(
              "outline-box press w-full rounded-sm px-2.5 py-2 text-left shadow-hard-sm",
              selectedId === pipeline.id
                ? "bg-morning-haze"
                : "bg-paper hover:bg-marble",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {pipeline.title}
              </span>
              <Badge>{pipeline.steps.length} Steps</Badge>
            </span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">
              {pipeline.summary}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The Runs of the Workspace (or of this Session), newest first; live ones pulse. */
export function RunsList({
  runs,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  titleOf,
  statusOf,
  emptyHint,
}: {
  runs: RunSummary[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (runId: string) => void;
  titleOf: (run: RunSummary) => string;
  /** The freshest status known for a Run (a Run being watched is ahead of the list). */
  statusOf: (run: RunSummary) => RunStatus;
  emptyHint: string;
}) {
  if (loading) return <Loading rows={3} />;
  if (error) return <ErrorNote onRetry={onRetry}>{error}</ErrorNote>;
  if (!runs || runs.length === 0) {
    return (
      <Empty title="No Runs yet" className="py-6">
        {emptyHint}
      </Empty>
    );
  }
  return (
    <ul className="space-y-1">
      {runs.map((run) => {
        const status = statusOf(run);
        return (
          <li key={run.id}>
            <button
              type="button"
              aria-current={selectedId === run.id ? "true" : undefined}
              onClick={() => onSelect(run.id)}
              className={cx(
                "outline-box press w-full rounded-sm px-2.5 py-2 text-left shadow-hard-sm",
                selectedId === run.id
                  ? "bg-morning-haze"
                  : isRunActive(status)
                    ? "border-federal-blue bg-paper hover:bg-marble"
                    : "bg-paper hover:bg-marble",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {titleOf(run)}
                </span>
                <Badge tone={RUN_STATUS_TONE[status]} dot={runPulses(status)}>
                  {RUN_STATUS_LABEL[status]}
                </Badge>
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-muted">
                {run.subject || humanize(run.pipelineId)}
              </span>
              <span className="mt-0.5 block text-[0.68rem] text-stone">
                {run.startedBy.name} · {timeAgo(run.createdAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
