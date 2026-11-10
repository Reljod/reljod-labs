"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Outcome } from "../domain/types";
import { formatTokens, formatUsd } from "../metrics";
import { findPack } from "../packs";
import { getSessionRuns } from "../server/actions";
import { isFinished } from "../view";
import { OUTCOME_STYLES } from "./labels";

export const SESSION_RUNS_KEY = ["prescreen-session-runs"];

const OUTCOMES: Outcome[] = ["fail", "needs_review", "pass"];

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The Pre-screen runs this browser started, newest first, so a visitor can go
 * back to any of them. Hidden until the Session has its first run.
 */
export function SessionRuns({ currentRunId }: { currentRunId?: string }) {
  const runs = useQuery({
    queryKey: SESSION_RUNS_KEY,
    queryFn: () => getSessionRuns(),
    // A run still going shows its status; check back until it settles.
    refetchInterval: (query) =>
      query.state.data?.some((run) => !isFinished(run.status)) ? 5000 : false,
  });
  const list = runs.data ?? [];
  if (list.length === 0) return null;

  // "-" when no run reported a cost: a missing price is never shown as $0.
  const costs = list.flatMap((run) =>
    run.costUsd === null ? [] : [run.costUsd],
  );
  const total =
    costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);

  return (
    <section
      aria-labelledby="session-runs-title"
      data-testid="session-runs"
      className="flex flex-col gap-3"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id="session-runs-title"
          className="font-mono text-lg font-bold uppercase"
        >
          This session
        </h2>
        <span className="font-mono text-xs text-ink-muted">
          {list.length} run{list.length === 1 ? "" : "s"} · {formatUsd(total)}{" "}
          spent · kept 30 days
        </span>
      </header>
      <ol className="flex flex-col gap-2">
        {list.map((run) => {
          const current = run.id === currentRunId;
          return (
            <li key={run.id}>
              <Link
                href={`/demos/document-compliance/runs/${run.id}`}
                data-testid="session-run"
                data-run-id={run.id}
                aria-current={current ? "page" : undefined}
                className={`outline-box grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-sm px-3 py-2 transition-shadow hover:shadow-hard-md sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto] ${
                  current ? "bg-morning-haze" : "bg-paper"
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-sm font-bold uppercase">
                    {findPack(run.packSlug)?.title ?? run.packSlug}
                    {current ? (
                      <span className="ml-2 text-xs text-federal-blue normal-case">
                        (viewing)
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {time(run.createdAt)} · {run.id.slice(0, 8)}
                  </span>
                </span>
                <span className="flex gap-1">
                  {run.status === "completed" ? (
                    OUTCOMES.map((outcome) => (
                      <span
                        key={outcome}
                        title={OUTCOME_STYLES[outcome].label}
                        className={`grid h-6 min-w-6 place-items-center rounded-sm px-1 font-mono text-xs font-bold ${OUTCOME_STYLES[outcome].className}`}
                      >
                        {run.counts[outcome]}
                      </span>
                    ))
                  ) : (
                    <span
                      className={`eyebrow rounded-sm px-2 py-1 ${
                        run.status === "failed"
                          ? "bg-seal-red text-paper"
                          : "bg-brass text-ink"
                      }`}
                    >
                      {run.status}
                    </span>
                  )}
                </span>
                <span className="hidden truncate font-mono text-xs text-ink-muted sm:block">
                  {run.model ?? "-"}
                </span>
                <span className="col-span-2 font-mono text-xs sm:col-span-1 sm:text-right">
                  {formatUsd(run.costUsd)} · {formatTokens(run.tokens)} tok
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
