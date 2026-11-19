"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { WorkflowRunView } from "../../domain/views";
import { formatStamp, relativeTime, useNow } from "../shell/time";
import { Badge, cx, Empty, type Tone } from "../ui";

const STATUS: Record<
  WorkflowRunView["status"],
  { tone: Tone; label: string; dot?: boolean }
> = {
  running: { tone: "blue", label: "Running", dot: true },
  sleeping: { tone: "neutral", label: "Sleeping" },
  waiting: { tone: "amber", label: "Waiting", dot: true },
  completed: { tone: "green", label: "Completed" },
  failed: { tone: "red", label: "Failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

const ACTIVE = new Set<WorkflowRunView["status"]>([
  "running",
  "sleeping",
  "waiting",
]);

/** "eod.run" → "eod run": a Workflow's kind, read aloud. */
const kindLabel = (kind: string) => kind.replace(/[._]/g, " ");

/**
 * Workflow runs, active ones first. A run that arrives slides in and a status
 * that changes re-stamps its badge, so a Fast-forward reads as end-of-day
 * happening. Press a run to read its trail of steps.
 */
export function WorkflowRuns({ runs }: { runs: WorkflowRunView[] }) {
  const now = useNow(10_000);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (runs.length === 0) {
    return (
      <Empty title="No Workflow has run yet">
        Fast-forward the clock: each day crossed starts an end-of-day run.
      </Empty>
    );
  }

  return (
    <ul className="divide-y divide-ink/15" data-testid="bank-ops-workflows">
      <AnimatePresence initial={false}>
        {runs.map((run) => {
          const status = STATUS[run.status];
          const expanded = open.has(run.id);
          const active = ACTIVE.has(run.status);
          return (
            <motion.li
              key={run.id}
              layout="position"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className={cx(!active && "bg-marble/30")}
            >
              <button
                type="button"
                onClick={() => toggle(run.id)}
                aria-expanded={expanded}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-marble/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue sm:grid-cols-[10rem_minmax(0,1fr)_auto_7rem]"
              >
                <span className="font-mono text-xs font-bold uppercase tracking-[0.04em]">
                  {kindLabel(run.kind)}
                </span>
                <span className="col-span-2 min-w-0 truncate text-sm sm:col-span-1">
                  {run.subject}
                </span>
                <span className="row-start-1 col-start-2 sm:row-auto sm:col-auto">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={run.status}
                      initial={{ opacity: 0, scale: 1.3 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.22 }}
                      className={cx(
                        "inline-flex",
                        run.status === "sleeping" && "tb-breathe",
                      )}
                    >
                      <Badge tone={status.tone} dot={status.dot}>
                        {status.label}
                      </Badge>
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span className="col-span-2 font-mono text-[0.7rem] text-ink-muted tabular-nums sm:col-span-1 sm:text-right">
                  {run.status === "sleeping" && run.wakeAt
                    ? `wakes ${relativeTime(run.wakeAt, now)}`
                    : run.endedAt
                      ? `ended ${relativeTime(run.endedAt, now)}`
                      : `started ${relativeTime(run.startedAt, now)}`}
                </span>
              </button>
              {expanded ? (
                <div className="border-ink/15 border-t bg-marble/40 px-3 py-2">
                  {run.detail ? (
                    <p className="mb-2 text-xs text-ink-muted">{run.detail}</p>
                  ) : null}
                  {run.steps.length === 0 ? (
                    <p className="text-xs text-ink-muted">No steps yet.</p>
                  ) : (
                    <ol className="relative space-y-1.5 border-ink/30 border-l-2 pl-3">
                      {run.steps.map((step, index) => (
                        <li
                          // biome-ignore lint/suspicious/noArrayIndexKey: steps only append; the index is their order.
                          key={index}
                          className="relative text-xs"
                        >
                          <span
                            aria-hidden="true"
                            className="absolute top-1 -left-[1.03rem] size-2 rounded-full border-2 border-ink bg-paper"
                          />
                          <span className="font-mono font-bold">
                            {step.name}
                          </span>
                          {step.note ? (
                            <span className="text-ink-muted">
                              {" "}
                              · {step.note}
                            </span>
                          ) : null}
                          <span className="ml-2 font-mono text-[0.65rem] text-ink-muted tabular-nums">
                            {formatStamp(step.at)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : null}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
