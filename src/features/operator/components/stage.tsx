"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { RunDetail, RunSummary } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { SCREEN_TITLES } from "../legacy/types";
import { stopRun } from "../server/actions";
import { ApprovalCard } from "./approval-card";
import { Expectations, Findings, Plan, VerdictCard } from "./checklist";
import { Comparison } from "./comparison";
import {
  clock,
  DRIVER_LABEL,
  duration,
  errorsLabel,
  modelLabel,
  STATUS_WORD,
  usd,
} from "./format";
import {
  activeItemId,
  isOver,
  metAt,
  pauseAt,
  planAt,
  type RunView,
  statusAt,
} from "./run-view";
import { Screen } from "./screen";
import { Scrubber } from "./scrubber";
import { Timeline } from "./timeline";
import {
  Button,
  cx,
  ErrorNote,
  friendly,
  Panel,
  Tag,
  useNow,
  useWrite,
} from "./ui";
import { usePlayer } from "./use-player";

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.58rem] tracking-[0.1em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="truncate font-bold tabular-nums">{children}</dd>
    </div>
  );
}

/** The chin of the terminal: where the Run stands at the Frame on screen. */
function StatusStrip({
  view,
  index,
  ticking,
}: {
  view: RunView;
  index: number;
  /** The newest Frame of a Run that is going: the time runs on the clock. */
  ticking: boolean;
}) {
  const now = useNow(ticking);
  const at = statusAt(view, index);
  const frame = view.frames[index];
  const elapsed =
    ticking && now > 0 && view.startedAt ? now - view.startedAt : at.elapsedMs;
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[0.7rem] sm:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.6fr)]">
      <Cell label="Screen">
        {frame
          ? `${frame.screen} ${SCREEN_TITLES[frame.screen]}`
          : "not up yet"}
      </Cell>
      <Cell label="Turn">{at.turn}</Cell>
      <Cell label="Actions">
        {at.actions}
        <span className="font-normal text-ink-muted">
          /{LIMITS.actionsPerRun}
        </span>
      </Cell>
      <Cell label="Cost">{usd(ticking ? view.costUsd : at.costUsd)}</Cell>
      <Cell label="Time">{clock(elapsed)}</Cell>
      <Cell label="Model">
        {view.driver === "operator" || view.driver === null
          ? modelLabel(view.model)
          : DRIVER_LABEL[view.driver]}
      </Cell>
    </dl>
  );
}

/** Stops the Run. Guarded against a second click, never asks first: it is the escape hatch. */
function StopButton({ runId }: { runId: string }) {
  const [error, setError] = useState<string | null>(null);
  const write = useWrite(async () => {
    setError(null);
    try {
      const result = await stopRun(runId);
      if ("error" in result) setError(result.error);
    } catch (caught) {
      setError(friendly(caught, "The Run could not be stopped."));
    }
  });
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="danger"
        pending={write.pending}
        pendingLabel="Stopping…"
        onClick={() => void write.run()}
      >
        Stop the Run
      </Button>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

/**
 * One Run on the stage: the Trail on the left, the Screen in the middle with
 * the scrubber under it, the checklist and the Verdict on the right. Mount it
 * once the Run is loaded, keyed by the Run, so the player starts where it
 * should: a recorded Run on its first Frame, a Run of the Owner's on its newest.
 */
export function Stage({
  detail,
  view,
  recorded,
  operatorRun,
}: {
  detail: RunDetail;
  view: RunView;
  /** A recorded Run shipped with the site: nothing to stop or approve. */
  recorded: boolean;
  /** The Operator's Run of the same Task, beside a Run by hand. */
  operatorRun: RunSummary | null;
}) {
  const over = isOver(view.status);
  const going = !over && !recorded;
  const frames = view.frames;
  const player = usePlayer(frames, going, recorded ? "first" : "last");
  const [watched, setWatched] = useState(false);
  const head = Math.max(0, frames.length - 1);
  const atHead = player.index >= head;
  const frame = frames[player.index] ?? null;
  const shown = frame?.n ?? null;

  // A pause is the centre of attention: the screen goes to the Frame it happened on.
  const pendingId = view.pending?.approvalId ?? null;
  const goLive = useRef(player.goLive);
  goLive.current = player.goLive;
  useEffect(() => {
    if (pendingId) goLive.current();
  }, [pendingId]);

  // The timeline's rows are memoised, so what they call must not change.
  const seek = useRef(player.seek);
  seek.current = player.seek;
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const jump = useCallback((n: number) => {
    const at = framesRef.current.findIndex((item) => item.n === n);
    if (at >= 0) seek.current(at);
  }, []);

  const paused = going && view.status === "paused" && view.pending !== null;
  const pausedHere = pauseAt(view.timeline, shown);
  const byHand = view.driver === "hand";
  const title = view.task?.title ?? detail.title;

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="font-mono text-lg font-bold uppercase">{title}</h2>
      <Tag tone={recorded ? "brass" : going ? "blue" : "neutral"}>
        {recorded ? "recorded Run" : STATUS_WORD[view.status]}
      </Tag>
      <Tag>{view.driver ? DRIVER_LABEL[view.driver] : "The Operator"}</Tag>
      <span className="font-mono text-xs text-ink-muted">
        Rules v{view.rulebookVersion ?? detail.rulebookVersion}
        {view.manifest ? ` · ${view.manifest.name}` : ""}
      </span>
    </div>
  );

  // A Run by hand has no Frames: its Findings and the comparison take the stage.
  if (frames.length === 0 && over)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <VerdictCard view={view} shown>
              {byHand ? (
                <p className="text-ink-muted">
                  The server replayed your {detail.metrics.actions} inputs in
                  the same machine and ran the same checks. You took{" "}
                  {duration(detail.metrics.ms)} with{" "}
                  {errorsLabel(detail.metrics.errors)}.
                </p>
              ) : null}
            </VerdictCard>
            {byHand ? (
              <Comparison hand={detail} operator={operatorRun} />
            ) : null}
          </div>
          <div className="flex flex-col gap-5">
            <Findings findings={view.findings} />
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_19rem] xl:items-start">
        <div className="order-2 xl:order-1">
          <Timeline
            items={view.timeline}
            activeId={activeItemId(view.timeline, shown)}
            shown={shown}
            going={going}
            onJump={jump}
          />
        </div>

        <div className="order-1 flex min-w-0 flex-col gap-3 xl:order-2">
          <Screen
            run={detail}
            frames={frames}
            index={player.index}
            plate="HARBOURMASTER · Port Authority of Meridia"
            lamp={
              paused
                ? "Stopped by the Guard"
                : going
                  ? player.following
                    ? "Live"
                    : "Live, you are looking back"
                  : recorded
                    ? "Recorded"
                    : "Replay"
            }
            lampTone={paused ? "stopped" : going ? "live" : "idle"}
            dimmed={paused}
            empty={
              going
                ? "Starting the Screen sandbox. The sign-on Screen shows in a moment."
                : "This Run has no Frames."
            }
            over={
              paused && view.pending ? (
                <div className="mt-3 flex justify-center sm:absolute sm:inset-0 sm:mt-0 sm:items-center sm:p-4">
                  <ApprovalCard
                    key={view.pending.approvalId}
                    runId={detail.id}
                    pending={view.pending}
                    rulebook={detail.rulebook ?? null}
                  />
                </div>
              ) : recorded && !watched && frames.length > 1 ? (
                <div className="absolute inset-0 grid place-items-center p-4">
                  <button
                    type="button"
                    onClick={() => {
                      setWatched(true);
                      player.toggle();
                    }}
                    className="outline-box press flex items-center gap-3 rounded-sm bg-brass px-4 py-3 font-mono text-sm font-bold uppercase"
                  >
                    <span aria-hidden="true">▶</span>
                    Watch a recorded Run
                  </button>
                </div>
              ) : null
            }
          >
            <StatusStrip
              view={view}
              index={player.index}
              ticking={going && atHead}
            />
          </Screen>

          <p className="flex min-h-10 items-start gap-2 text-sm">
            <span className="eyebrow mt-0.5 shrink-0 text-[0.62rem] text-ink-muted">
              Intent
            </span>
            <span className={cx(!frame?.intent && "text-ink-muted")}>
              {frame?.intent ||
                (frame?.action === null
                  ? "HARBOURMASTER is up. Nothing keyed yet."
                  : going
                    ? "Waiting for the Operator."
                    : "No intent given for this Action.")}
            </span>
          </p>
          {frame?.message ? (
            <p className="font-mono text-xs text-ink-muted">
              HARBOURMASTER said: {frame.message}
            </p>
          ) : null}
          {pausedHere && !paused ? (
            <p className="border-2 border-ink bg-brass/25 px-3 py-2 text-sm">
              <span className="font-semibold">
                The Guard paused the Run here.
              </span>{" "}
              {pausedHere.pending.label}.{" "}
              {pausedHere.decision === "approved"
                ? "A person approved it."
                : pausedHere.decision === "refused"
                  ? "A person refused it."
                  : pausedHere.decision === "expired"
                    ? "Nobody decided in time, so the harness refused it."
                    : ""}
            </p>
          ) : null}
          <Panel bodyClassName="p-3">
            <Scrubber player={player} count={frames.length} going={going} />
          </Panel>
          <output aria-live="assertive" className="sr-only">
            {paused && view.pending
              ? `The Run is paused. The Guard stopped a key: ${view.pending.label}. Approve or refuse.`
              : ""}
          </output>
        </div>

        <div className="order-3 flex min-w-0 flex-col gap-5">
          {going ? <StopButton runId={detail.id} /> : null}
          <VerdictCard view={view} shown={atHead} />
          <Expectations
            expected={detail.expected}
            met={metAt(view, player.index, detail.expected.length)}
          />
          <Plan items={planAt(view, player.index)} />
          {over && atHead ? <Findings findings={view.findings} /> : null}
          {over && !atHead ? (
            <p className="text-xs text-ink-muted">
              The Verdict and the Findings show at the last Frame.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
