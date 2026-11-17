"use client";

import type { PipelineSpec } from "../../domain/pipeline";
import { isRunActive, type RunView, type StartedVia } from "../../domain/run";
import { Badge, Button, ErrorNote, useWrite } from "../ui";
import { formatDuration, humanize } from "./format";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, runPulses } from "./status";
import { versionLabel } from "./step-detail";

const VIA_LABEL: Record<StartedVia, string> = {
  chat: "in chat",
  mcp: "through the MCP server",
  app: "in the app",
  demo: "by Demo mode",
};

export const runTitle = (
  spec: Pick<PipelineSpec, "title"> | null,
  run: Pick<RunView, "pipelineId">,
) => spec?.title ?? humanize(run.pipelineId);

/** The Run at a glance: what, who, how long, which Rule Versions, and Stop. */
export function RunHeader({
  run,
  spec,
  now,
  ruleTitles,
  onStop,
  onOpenSession,
  onOpenRule,
}: {
  run: RunView;
  spec: Pick<PipelineSpec, "title"> | null;
  now: number;
  ruleTitles: ReadonlyMap<string, string>;
  /** Stops the Run; throws a message to show. */
  onStop: () => Promise<unknown>;
  onOpenSession: (sessionId: string) => void;
  onOpenRule: (ruleId: string) => void;
}) {
  const active = isRunActive(run.status);
  const stop = useWrite(onStop);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsed = Math.max(0, end - Date.parse(run.createdAt));
  const versions = Object.entries(run.ruleVersions);

  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-mono text-base font-bold uppercase">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {runTitle(spec, run)}
            </span>
            <Badge
              tone={RUN_STATUS_TONE[run.status]}
              dot={runPulses(run.status)}
            >
              {RUN_STATUS_LABEL[run.status]}
            </Badge>
          </h2>
          {run.subject ? (
            <p className="mt-0.5 text-sm text-ink-muted [overflow-wrap:anywhere]">
              {run.subject}
            </p>
          ) : null}
        </div>
        {active ? (
          <Button
            variant="secondary"
            size="sm"
            pending={stop.pending}
            pendingLabel="Stopping…"
            onClick={() => void stop.run()}
          >
            Stop
          </Button>
        ) : null}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>
          Started by {run.startedBy.name} {VIA_LABEL[run.startedVia]}
        </span>
        <span
          className="font-mono"
          title="Time from start to finish, or so far"
        >
          {active ? "Running for" : "Took"} {formatDuration(elapsed)}
        </span>
        {run.sessionId ? (
          <button
            type="button"
            onClick={() => run.sessionId && onOpenSession(run.sessionId)}
            className="font-medium text-federal-blue underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-federal-blue"
          >
            Open the Session
          </button>
        ) : null}
      </p>
      <ErrorNote>{stop.error}</ErrorNote>
      {versions.length > 0 ? (
        <details className="rounded-sm outline-box bg-paper text-xs">
          <summary className="cursor-pointer px-2.5 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-federal-blue">
            Rule Versions used ({versions.length})
          </summary>
          <ul className="grid gap-x-4 gap-y-0.5 border-ink border-t-2 px-2.5 py-2 sm:grid-cols-2">
            {versions.map(([ruleId, version]) => (
              <li key={ruleId} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenRule(ruleId)}
                  title="Open this Rule in Skills"
                  className="min-w-0 truncate text-left text-federal-blue underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-federal-blue"
                >
                  {ruleTitles.get(ruleId) ?? ruleId}
                </button>
                <Badge>{versionLabel(version)}</Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </header>
  );
}
