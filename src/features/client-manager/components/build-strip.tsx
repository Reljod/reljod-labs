"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import { type BuildState, spendOf } from "../domain/build-state";
import { JOB_LABELS, JOBS } from "../domain/events";
import { Icon } from "./icons";

/**
 * A Build while it runs, in one line: a dot per Job that fills as it
 * finishes, what is happening now, the facts so far, the self-corrections,
 * the cost, and a way to stop. Stopping asks first, is sent once, and says
 * if it failed.
 */
export function BuildStrip({
  state,
  canStop,
  onStop,
}: {
  state: BuildState;
  canStop: boolean;
  onStop: () => Promise<unknown>;
}) {
  const status = state.end?.status ?? "running";
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const sent = useRef(false);
  const stop = async () => {
    if (sent.current) return;
    sent.current = true;
    setStopping(true);
    setStopError(null);
    try {
      await onStop();
    } catch (failure) {
      setStopError(
        failure instanceof Error ? failure.message : "Could not stop it.",
      );
      sent.current = false;
    } finally {
      setStopping(false);
      setConfirming(false);
    }
  };
  const current = state.runs.at(-1);
  const spend = spendOf(state);
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden border-ink border-b-2 bg-ink text-paper"
      data-testid="build-card"
      data-status={status}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2">
        <ol className="flex items-center gap-1" aria-label="Build steps">
          {JOBS.map((job) => {
            const runs = state.runs.filter((run) => run.job === job);
            const last = runs.at(-1);
            const tone = !last
              ? "bg-paper/20"
              : last.state === "error"
                ? "bg-seal-red"
                : last.state === "start"
                  ? "cm-pulse bg-brass"
                  : "bg-ivy";
            return (
              <li key={job} title={JOB_LABELS[job].title}>
                <span className={`block size-2 rounded-full ${tone}`} />
              </li>
            );
          })}
        </ol>
        <p className="min-w-0 flex-1 truncate font-mono text-xs">
          {status === "running" ? (
            <span className="cm-text-shimmer">
              {current
                ? `${JOB_LABELS[current.job].verb}${current.round ? ` · round ${current.round}` : ""}…`
                : "Starting…"}
            </span>
          ) : status === "completed" ? (
            "Done"
          ) : (
            (state.end?.error ?? "Stopped")
          )}
        </p>
        <span className="flex items-center gap-3 font-mono text-[0.7rem] text-paper/70 tabular-nums">
          <span title="Facts so far">● {state.graph.nodes.length}</span>
          <span title="Self-corrections">⇄ {state.repairs.length}</span>
          <span title="Model spend">${spend.costUsd.toFixed(3)}</span>
        </span>
        {status === "running" && canStop ? (
          confirming || stopping ? (
            <span className="flex items-center gap-1 font-mono text-[0.7rem]">
              <span className="text-paper/80">Stop this build?</span>
              <button
                type="button"
                onClick={() => void stop()}
                disabled={stopping}
                aria-busy={stopping}
                className="rounded-sm border border-paper bg-seal-red px-1.5 py-0.5 font-bold text-paper uppercase disabled:opacity-60"
              >
                {stopping ? "Stopping…" : "Stop"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={stopping}
                className="rounded-sm border border-paper/40 px-1.5 py-0.5 font-bold text-paper/80 uppercase hover:bg-paper/10 disabled:opacity-60"
              >
                Keep going
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1 rounded-sm border border-paper/40 px-1.5 py-0.5 font-mono text-[0.7rem] font-bold text-paper/80 uppercase hover:border-paper hover:bg-seal-red hover:text-paper"
            >
              <Icon name="stop" className="size-3" />
              Stop
            </button>
          )
        ) : null}
        {stopError ? (
          <p role="alert" className="w-full font-mono text-[0.7rem] text-brass">
            {stopError}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}
