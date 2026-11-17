"use client";

import { useCallback, useRef, useState } from "react";
import { isOver, type RunStatus, type RunView } from "../../domain/run";
import { ago, usd } from "../format";
import {
  buttonClass,
  InlineError,
  linkButtonClass,
  quietButtonClass,
  Skeleton,
  Tabs,
  tabPanelProps,
} from "../ui";
import { useFrames } from "../use-frames";
import { useRun } from "../use-run";
import { CostPanel } from "./cost-panel";
import { DeckPanel } from "./deck-panel";
import { DocumentPanel, recordingName } from "./document-panel";
import { RunLogList, StageRail, StopButton } from "./stage-rail";
import { StepsPanel } from "./steps-panel";

type ResultTab = "steps" | "document" | "deck" | "cost";

export const RUN_STATUS: Record<
  RunStatus,
  { label: string; className: string }
> = {
  queued: { label: "Queued", className: "bg-limestone text-ink" },
  running: { label: "Running", className: "bg-federal-blue text-paper" },
  completed: { label: "Finished", className: "bg-ivy text-paper" },
  failed: { label: "Failed", className: "bg-seal-red text-paper" },
  stopped: { label: "Stopped", className: "bg-stone text-paper" },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const look = RUN_STATUS[status];
  return (
    <span
      className={`outline-box eyebrow inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-bold ${look.className}`}
    >
      {status === "running" || status === "queued" ? (
        <span
          aria-hidden="true"
          className="ho-pulse size-1.5 rounded-full bg-current"
        />
      ) : null}
      {look.label}
    </span>
  );
}

/**
 * One open Run: the Recording and the Stage rail on the left (sticky on wide
 * screens), the results filling in live on the right.
 */
export function RunScreen({
  runId,
  generation,
  currentRulesVersion,
  onClose,
  onRedone,
  onEnded,
}: {
  runId: string;
  generation: number;
  currentRulesVersion: number;
  onClose: () => void;
  onRedone: (runId: string) => void;
  /** The Run finished while open: refresh the spend and the Runs list. */
  onEnded: () => void;
}) {
  const { state, feed, retry } = useRun(runId, generation, onEnded);

  if (state.phase === "loading" || state.phase === "idle") {
    return (
      <div
        className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        aria-busy="true"
      >
        <div className="flex flex-col gap-4">
          <div className="ho-shimmer aspect-video w-full rounded-sm" />
          <Skeleton lines={7} />
        </div>
        <Skeleton lines={10} />
        <span className="sr-only" aria-live="polite">
          Opening the Run…
        </span>
      </div>
    );
  }
  if (state.phase === "missing") {
    return (
      <div className="flex max-w-xl flex-col items-start gap-3">
        <p className="font-mono text-lg font-bold uppercase">Run not found</p>
        <p className="text-ink-muted">
          It may have been made under another Guest pass or account, or deleted.
        </p>
        <button type="button" onClick={onClose} className={buttonClass}>
          Start a new conversion
        </button>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="flex max-w-xl flex-col items-start gap-3">
        <p className="font-mono text-lg font-bold uppercase">
          The Run could not be opened
        </p>
        <InlineError>{state.error}</InlineError>
        <div className="flex gap-2">
          <button type="button" onClick={retry} className={buttonClass}>
            Try again
          </button>
          <button type="button" onClick={onClose} className={quietButtonClass}>
            Back
          </button>
        </div>
      </div>
    );
  }
  return (
    <OpenRun
      run={state.run}
      feed={feed}
      onRetryFeed={retry}
      currentRulesVersion={currentRulesVersion}
      onClose={onClose}
      onRedone={onRedone}
    />
  );
}

function OpenRun({
  run,
  feed,
  onRetryFeed,
  currentRulesVersion,
  onClose,
  onRedone,
}: {
  run: RunView;
  feed: ReturnType<typeof useRun>["feed"];
  onRetryFeed: () => void;
  currentRulesVersion: number;
  onClose: () => void;
  onRedone: (runId: string) => void;
}) {
  const [tab, setTab] = useState<ResultTab>("steps");
  const video = useRef<HTMLVideoElement>(null);
  const [videoBroken, setVideoBroken] = useState(false);
  const { urls, capture, progress } = useFrames(run.id, run.videoUrl);

  const seek = useCallback((seconds: number) => {
    const element = video.current;
    if (!element) return;
    element.currentTime = Math.max(0, seconds);
    void element.play().catch(() => {});
    const box = element.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) {
      element.scrollIntoView({ block: "center" });
    }
  }, []);

  const over = isOver(run.status);
  const deckBadge = run.approval
    ? run.approval.status === "approved"
      ? "Approved"
      : "Held"
    : run.rounds.length > 0
      ? `R${run.rounds.length}`
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onClose}
          className={`${linkButtonClass} self-start text-sm`}
        >
          ← New conversion
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="min-w-0 font-mono text-xl font-bold leading-tight tracking-[0.02em] uppercase">
            {run.process?.title ?? run.title}
          </h2>
          <span aria-live="polite">
            <RunStatusBadge status={run.status} />
          </span>
        </div>
        <p className="text-sm text-ink-muted">
          {run.source.kind === "sample" ? "Sample" : "Upload"}:{" "}
          {recordingName(run)} · started {ago(run.createdAt)} ·{" "}
          {usd(run.costUsd)}
        </p>
        {run.status === "failed" && run.error ? (
          <p
            role="alert"
            className="rounded-sm border-l-4 border-seal-red bg-seal-red/10 px-3 py-2 text-sm"
          >
            {run.error}
          </p>
        ) : null}
        {feed === "reconnecting" && !isOver(run.status) ? (
          <p aria-live="polite" className="text-sm text-oak">
            The live feed dropped; reconnecting…
          </p>
        ) : null}
        {feed === "lost" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <span className="text-seal-red">
              The live feed was lost. The Run carries on on the server.
            </span>
            <button
              type="button"
              onClick={onRetryFeed}
              className={quietButtonClass}
            >
              Reconnect
            </button>
          </div>
        ) : null}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:pr-1">
          <div className="outline-box overflow-hidden rounded-sm bg-ink shadow-hard-md">
            {run.videoUrl && !videoBroken ? (
              // biome-ignore lint/a11y/useMediaCaption: the Steps and the transcript are the text version of the call
              <video
                ref={video}
                src={run.videoUrl}
                controls
                playsInline
                preload="metadata"
                onError={() => setVideoBroken(true)}
                className="aspect-video w-full bg-ink"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center p-4 text-center text-sm text-paper/75">
                The Recording is no longer available. The results below stay.
              </div>
            )}
          </div>
          <div className="outline-box rounded-sm bg-paper p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="eyebrow font-bold">Pipeline</p>
              {over ? null : <StopButton runId={run.id} />}
            </div>
            <StageRail run={run} />
          </div>
          <RunLogList logs={run.logs} />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <Tabs<ResultTab>
            id="ho-result"
            label="Results"
            variant="inner"
            value={tab}
            onChange={setTab}
            items={[
              {
                id: "steps",
                label: "Steps",
                badge: run.process ? run.process.steps.length : undefined,
              },
              { id: "document", label: "Document" },
              { id: "deck", label: "Deck", badge: deckBadge },
              {
                id: "cost",
                label: "Cost",
                badge: run.calls.length > 0 ? usd(run.costUsd) : undefined,
              },
            ]}
          />
          <div {...tabPanelProps("ho-result", tab)}>
            {tab === "steps" ? <StepsPanel run={run} onSeek={seek} /> : null}
            {tab === "document" ? (
              <DocumentPanel
                run={run}
                urls={urls}
                capture={capture}
                progress={progress}
                onSeek={seek}
              />
            ) : null}
            {tab === "deck" ? (
              <DeckPanel
                run={run}
                urls={urls}
                capture={capture}
                progress={progress}
                currentRulesVersion={currentRulesVersion}
                onRedone={onRedone}
              />
            ) : null}
            {tab === "cost" ? <CostPanel run={run} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
