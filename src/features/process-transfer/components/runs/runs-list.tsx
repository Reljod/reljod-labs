"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RunSummary } from "../../domain/run";
import { sampleBySlug } from "../../domain/samples";
import { RunStatusBadge } from "../convert/run-screen";
import { usd, when } from "../format";
import { buttonClass, Empty, focusRing } from "../ui";

function sourceLabel(run: RunSummary): string {
  return run.source.kind === "sample"
    ? `Sample · ${sampleBySlug(run.source.slug)?.title ?? run.source.slug}`
    : `Upload · ${run.source.name}`;
}

function ApprovalMark({ approval }: { approval: RunSummary["approval"] }) {
  if (!approval) return <span className="text-ink-muted">—</span>;
  return (
    <span
      className={`inline-block rotate-[-4deg] rounded-sm border-2 px-1.5 font-mono text-[11px] font-bold tracking-[0.12em] uppercase ${approval === "approved" ? "border-ivy text-ivy" : "border-seal-red text-seal-red"}`}
    >
      {approval === "approved" ? "Approved" : "Held"}
    </span>
  );
}

/**
 * This Owner's Runs, newest first. Pointing at one starts reading it
 * (`onIntent`), so the click opens it without a wait.
 */
export function RunsList({
  runs,
  openId,
  onOpen,
  onIntent,
  onNew,
}: {
  runs: RunSummary[];
  openId: string | null;
  onOpen: (runId: string) => void;
  onIntent?: (runId: string) => void;
  onNew: () => void;
}) {
  const intent = useIntent(onIntent);
  if (runs.length === 0) {
    return (
      <Empty
        title="No Runs yet"
        action={
          <button type="button" onClick={onNew} className={buttonClass}>
            Convert a recording
          </button>
        }
      >
        Every Recording you convert is kept here with its Process, its Deck and
        what it cost.
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Your Runs, newest first. Only you can see them.
      </p>
      <ul className="flex flex-col gap-2">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onOpen(run.id)}
              onPointerEnter={() => intent.start(run.id)}
              onPointerLeave={intent.cancel}
              onFocus={() => onIntent?.(run.id)}
              aria-current={run.id === openId ? "true" : undefined}
              className={`outline-box press grid w-full gap-x-4 gap-y-2 rounded-sm p-3 text-left sm:grid-cols-[minmax(0,1fr)_auto] ${run.id === openId ? "bg-morning-haze" : "bg-paper"} ${focusRing}`}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{run.title}</span>
                  <RunStatusBadge status={run.status} />
                </span>
                <span className="truncate text-sm text-ink-muted">
                  {sourceLabel(run)} · {when(run.createdAt)}
                </span>
              </span>
              <span className="grid grid-cols-[auto_auto_auto_auto] items-center justify-start gap-x-4 font-mono text-xs sm:grid-cols-[4.5rem_4.5rem_6.5rem_4.5rem] sm:justify-end">
                <span>
                  <span className="text-ink-muted">Steps </span>
                  {run.steps ?? "—"}
                </span>
                <span>
                  <span className="text-ink-muted">Slides </span>
                  {run.slides ?? "—"}
                </span>
                <span>
                  <ApprovalMark approval={run.approval} />
                </span>
                <span className="text-right font-bold">{usd(run.costUsd)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How long the pointer rests on a Run before it is read ahead. */
const INTENT_MS = 120;

/** Reads a Run ahead only when the pointer rests on it, not as it passes. */
function useIntent(onIntent?: (runId: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const start = useCallback(
    (runId: string) => {
      cancel();
      if (onIntent)
        timer.current = setTimeout(() => onIntent(runId), INTENT_MS);
    },
    [cancel, onIntent],
  );
  useEffect(() => cancel, [cancel]);
  return { start, cancel };
}
