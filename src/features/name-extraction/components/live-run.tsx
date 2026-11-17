"use client";

import { useMotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { RunStage } from "./run-stage";
import { isOver, type RunView } from "./run-view";
import { Timeline } from "./timeline";
import { Button, ErrorNote, friendly } from "./ui";

/**
 * A Run in flight, on the same stage as the hero's replay: pages lighting up,
 * names streaming in, cost and time ticking. Stop is the escape hatch: it is
 * guarded against a double click and never asks first. The raw step-by-step
 * timeline waits under "Under the hood".
 */
export function LiveRun({
  view,
  total,
  onStop,
}: {
  view: RunView;
  total: number;
  /** Resolves to an error message, or null. */
  onStop: () => Promise<string | null>;
}) {
  const clock = useMotionValue(0);
  const live = !isOver(view.status);
  useEffect(() => {
    const set = () => {
      if (view.startedAt === null) return;
      clock.set((view.endedAt ?? Date.now()) - view.startedAt);
    };
    set();
    if (!live) return;
    const timer = setInterval(set, 250);
    return () => clearInterval(timer);
  }, [clock, live, view.startedAt, view.endedAt]);

  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const guard = useRef(false);
  const stop = async () => {
    if (guard.current) return;
    guard.current = true;
    setStopping(true);
    setStopError(null);
    try {
      const problem = await onStop();
      if (problem) setStopError(problem);
    } catch (error) {
      setStopError(friendly(error, "Could not stop the run."));
    } finally {
      guard.current = false;
      setStopping(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <RunStage
        view={view}
        total={total}
        clock={clock}
        top={
          <div className="flex flex-wrap items-center justify-between gap-2 border-paper/10 border-b px-4 py-2.5 sm:px-6">
            <p className="flex items-center gap-2 text-sm">
              <span className="size-2 rounded-full bg-seal-red motion-safe:animate-pulse" />
              {view.status === "queued" || view.startedAt === null
                ? "Starting up…"
                : "Live · reading the document"}
            </p>
            <Button
              variant="danger"
              size="sm"
              pending={stopping}
              pendingLabel="Stopping…"
              onClick={() => void stop()}
            >
              Stop
            </Button>
          </div>
        }
      />
      {stopError ? <ErrorNote>{stopError}</ErrorNote> : null}
      <details className="group rounded-md border border-ink/15 bg-paper">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-mono text-xs font-bold uppercase">
          <span aria-hidden="true" className="group-open:rotate-90">
            ▸
          </span>
          Under the hood: every step and the code it ran
        </summary>
        <div className="border-ink/10 border-t p-3">
          <Timeline items={view.timeline} live={live} />
        </div>
      </details>
    </div>
  );
}
