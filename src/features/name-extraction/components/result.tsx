"use client";

import { useMemo } from "react";
import { apiPath } from "../domain/api";
import type {
  Comparison,
  DocumentOverview,
  DocumentSource,
} from "../domain/contract";
import { ComparisonView } from "./comparison";
import { DocReader } from "./doc-reader";
import { clockText, usd } from "./format";
import { plural } from "./plain";
import { RegisterTable } from "./register-table";
import type { RunView } from "./run-view";
import { ComparisonSkeleton } from "./skeletons";
import { Timeline } from "./timeline";
import { ErrorNote } from "./ui";
import { serverLoader } from "./use-pages";
import { useCachedRead } from "./use-read";

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
      <p className="rounded-sm border border-brass bg-brass/15 px-3 py-2 text-sm">
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
  const loader = useMemo(() => serverLoader(source, runId), [source, runId]);
  // A finished Run's comparison and overview never change: kept for the visit.
  const forever = Number.POSITIVE_INFINITY;
  const compared = useCachedRead<Comparison>(
    source.kind === "corpus" ? apiPath.comparison(runId) : null,
    forever,
    "The result could not load.",
  );
  const overviewRead = useCachedRead<DocumentOverview>(
    source.kind === "corpus" ? null : apiPath.overview(source, runId),
    forever,
    "The result could not load.",
  );
  const comparison = compared.data ?? null;
  const overview = overviewRead.data ?? null;
  const error = compared.error ?? overviewRead.error ?? null;

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
          <ComparisonSkeleton />
        )
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-sm border-2 border-ink bg-paper p-5 shadow-hard-md">
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
      <details className="group outline-box rounded-sm bg-paper">
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
