"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Comparison,
  DocumentOverview,
  DocumentSource,
} from "../domain/contract";
import { compareRun, documentOverview } from "../server/actions";
import { ComparisonView } from "./comparison";
import { DocReader } from "./doc-reader";
import { clockText, usd } from "./format";
import { plural } from "./plain";
import { RegisterTable } from "./register-table";
import type { RunView } from "./run-view";
import { Timeline } from "./timeline";
import { ErrorNote, friendly } from "./ui";
import { serverLoader } from "./use-pages";

/** "100 pages · $0.11 · 3m 11s": what a finished Run took. */
export function factsOf(view: RunView, pages: number) {
  const ms =
    view.startedAt !== null && view.endedAt !== null
      ? view.endedAt - view.startedAt
      : 0;
  return `${plural(pages, "page")} · ${usd(view.cost.total.costUsd)} · ${clockText(ms)}`;
}

function EndNote({ view }: { view: RunView }) {
  if (view.status === "failed")
    return (
      <ErrorNote>
        This run failed{view.error ? `: ${view.error}` : "."} Below is what it
        found before it stopped.
      </ErrorNote>
    );
  if (view.status === "stopped" || view.stoppedBy)
    return (
      <p className="rounded-md border border-brass bg-brass/15 px-3 py-2 text-sm">
        This run ended early
        {view.stoppedBy === "cost"
          ? " at its spending limit"
          : view.stoppedBy === "turns"
            ? " at its step limit"
            : ""}
        . Below is what it found by then.
      </p>
    );
  return null;
}

/**
 * A finished Run. On a demo Document: the score and the side-by-side
 * comparison with the answer key. On an Upload: the document with the names
 * found highlighted, and the list with its CSV export.
 */
export function RunResult({
  runId,
  view,
  source,
  total,
  title,
  reviewBelow,
}: {
  /** The Rulebook's threshold: below it a name is flagged for review. */
  reviewBelow: number;
  runId: string;
  view: RunView;
  source: DocumentSource;
  total: number;
  title: string;
}) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [overview, setOverview] = useState<DocumentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loader = useMemo(() => serverLoader(source, runId), [source, runId]);

  useEffect(() => {
    let live = true;
    setError(null);
    const fail = (caught: unknown) => {
      if (live) setError(friendly(caught, "The result could not load."));
    };
    if (source.kind === "corpus")
      compareRun(runId).then((result) => {
        if (!live) return;
        if ("error" in result) setError(result.error);
        else setComparison(result);
      }, fail);
    else
      documentOverview({ source, runId }).then((result) => {
        if (!live) return;
        if ("error" in result) setError(result.error);
        else setOverview(result);
      }, fail);
    return () => {
      live = false;
    };
  }, [runId, source]);

  return (
    <div className="flex flex-col gap-5">
      <EndNote view={view} />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {source.kind === "corpus" ? (
        comparison ? (
          <ComparisonView
            key={runId}
            loader={loader}
            total={total}
            comparison={comparison}
            summary={factsOf(view, total)}
          />
        ) : error ? null : (
          <div className="h-48 animate-pulse rounded-md border-2 border-ink/10 bg-paper/60" />
        )
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-md border-2 border-ink bg-paper p-5 shadow-hard-md">
            <p className="eyebrow text-[0.65rem] text-ivy">Finished</p>
            <p className="font-mono text-2xl font-bold uppercase sm:text-3xl">
              {plural(view.names.length, "name")} found
            </p>
            <p className="text-sm text-ink-muted">{factsOf(view, total)}</p>
          </div>
          <DocReader
            key={runId}
            loader={loader}
            total={total}
            overview={overview}
            side="run"
            title="Names found"
          />
          <RegisterTable
            names={view.names}
            reviewBelow={reviewBelow}
            title={title}
          />
        </>
      )}
      <details className="group rounded-md border border-ink/15 bg-paper">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-mono text-xs font-bold uppercase">
          <span aria-hidden="true" className="group-open:rotate-90">
            ▸
          </span>
          Under the hood: every step and the code it ran
        </summary>
        <div className="border-ink/10 border-t p-3">
          <Timeline items={view.timeline} live={false} />
        </div>
      </details>
    </div>
  );
}
