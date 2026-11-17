"use client";

import { motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  DocumentOverview,
  DocumentSource,
  Replay,
} from "../domain/contract";
import { documentOverview } from "../server/actions";
import { ComparisonView } from "./comparison";
import { DocReader } from "./doc-reader";
import { clockText, usd } from "./format";
import { LiveRun } from "./live-run";
import { replayPage } from "./marks";
import { SOFT } from "./motion-kit";
import { PageStack } from "./page-stack";
import { plural } from "./plain";
import { RunResult } from "./result";
import { isOver } from "./run-view";
import { Button, cx, ErrorNote, useWrite } from "./ui";
import { serverLoader } from "./use-pages";
import type { RunState } from "./use-run";

/** A Document the page can open: a demo one or an Upload. */
export type OpenDoc = {
  source: DocumentSource;
  title: string;
  genre: string;
  pages: number;
  /** Names in the answer key (demo Documents only). */
  expected: number | null;
  /** The card's id, for the shared page-stack transition. */
  stack: string;
};

export const sourceKey = (source: DocumentSource) =>
  source.kind === "corpus" ? source.corpusId : source.uploadId;

function Header({
  doc,
  onBack,
  action,
  eyebrow,
}: {
  doc: OpenDoc;
  onBack: () => void;
  action?: ReactNode;
  eyebrow: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start font-mono text-xs font-bold text-federal-blue uppercase underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-federal-blue"
      >
        ← All documents
      </button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          <PageStack pages={doc.pages} layoutId={doc.stack} size="sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="eyebrow text-[0.65rem] text-federal-blue">
              {eyebrow}
            </p>
            <h2 className="font-mono text-xl leading-tight font-bold uppercase sm:text-3xl">
              {doc.title}
            </h2>
            <p className="font-mono text-xs text-ink-muted">
              {doc.genre} · {plural(doc.pages, "page")}
              {doc.expected !== null
                ? ` · ${plural(doc.expected, "name")} inside`
                : ""}
            </p>
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}

/** The Document's overview (names per page, every name), or null until it loads. */
function useOverview(source: DocumentSource) {
  const [overview, setOverview] = useState<DocumentOverview | null>(null);
  useEffect(() => {
    let live = true;
    documentOverview({ source }).then(
      (result) => {
        if (live && !("error" in result)) setOverview(result);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [source]);
  return overview;
}

/**
 * An open Document: before a Run, the reader with the names Sieve should
 * find and "Run Sieve on this document"; during one, the live stage; after
 * it, the result.
 */
export function Workspace({
  doc,
  runId,
  run,
  busy,
  reviewBelow,
  onBack,
  onStart,
  onStop,
}: {
  doc: OpenDoc;
  runId: string | null;
  run: RunState;
  /** A Run of this person's is in flight elsewhere. */
  busy: boolean;
  reviewBelow: number;
  onBack: () => void;
  /** Resolves to an error message, or null. */
  onStart: () => Promise<string | null>;
  onStop: () => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const start = useWrite(async () => {
    setError(null);
    const problem = await onStart().catch((caught: unknown) =>
      caught instanceof Error ? caught.message : "Could not start.",
    );
    if (problem) setError(problem);
  });
  const overview = useOverview(doc.source);
  const loader = useMemo(() => serverLoader(doc.source), [doc.source]);
  const { view } = run;
  const over = isOver(view.status);
  const total = view.document?.pages ?? doc.pages;

  const startButton = (label: string) => (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={() => void start.run()}
        disabled={start.pending || busy}
        aria-busy={start.pending || undefined}
        className={cx(
          "press inline-flex h-12 items-center gap-2 rounded-sm border-2 border-ink bg-federal-blue px-5 font-mono text-sm font-bold text-paper uppercase",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {start.pending ? (
          <span className="size-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />
        ) : (
          <span aria-hidden="true">▶</span>
        )}
        {start.pending ? "Starting…" : label}
      </button>
      {busy && !start.pending ? (
        <span className="text-xs text-ink-muted">
          A run is in flight. Stop it or let it finish first.
        </span>
      ) : null}
    </div>
  );

  return (
    <motion.section
      aria-label={doc.title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={SOFT}
      className="flex flex-col gap-6"
    >
      <Header
        doc={doc}
        onBack={onBack}
        eyebrow={
          runId === null
            ? doc.expected !== null
              ? "Preview · the names Sieve should find are highlighted"
              : "Preview"
            : over
              ? "Result"
              : "Live run"
        }
        action={
          runId === null
            ? startButton("Run Sieve on this document")
            : over
              ? startButton("Run again")
              : null
        }
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {runId === null ? (
        <DocReader
          key={sourceKey(doc.source)}
          loader={loader}
          total={doc.pages}
          overview={overview}
          side="key"
          title={doc.expected !== null ? "Names to find" : "Names"}
          note={
            doc.expected === null
              ? "Run Sieve to find the names in your document."
              : undefined
          }
        />
      ) : run.loading ? (
        <div className="h-96 animate-pulse rounded-md bg-ink/80" />
      ) : run.missing ? (
        <ErrorNote>
          That run isn't on your account, or it can't load right now.
        </ErrorNote>
      ) : over ? (
        <RunResult
          runId={runId}
          view={view}
          source={doc.source}
          total={total}
          title={doc.title}
          reviewBelow={reviewBelow}
        />
      ) : (
        <LiveRun view={view} total={total} onStop={onStop} />
      )}
    </motion.section>
  );
}

/** The hero's recorded Run, set side by side against the answer key. */
export function ReplayComparison({
  replay,
  onBack,
  onRunIt,
}: {
  replay: Replay;
  onBack: () => void;
  onRunIt: () => void;
}) {
  const source: DocumentSource = useMemo(
    () => ({ kind: "corpus", corpusId: replay.corpusId }),
    [replay.corpusId],
  );
  const loader = useMemo(
    () =>
      serverLoader(source, null, (page) =>
        replayPage(page, replay.names, replay.comparison.rows),
      ),
    [source, replay],
  );
  const doc: OpenDoc = {
    source,
    title: replay.title,
    genre: replay.genre,
    pages: replay.pages,
    expected: replay.comparison.score?.expected ?? null,
    stack: `sv-replay-${replay.corpusId}`,
  };
  return (
    <motion.section
      aria-label={`${replay.title}, side by side`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col gap-6"
    >
      <Header
        doc={doc}
        onBack={onBack}
        eyebrow="The recorded run, checked against the answer key"
        action={
          <Button variant="primary" onClick={onRunIt}>
            Run it yourself
          </Button>
        }
      />
      <ComparisonView
        loader={loader}
        total={replay.pages}
        comparison={replay.comparison}
        summary={`${plural(replay.pages, "page")} · ${usd(replay.costUsd)} · ${clockText(replay.durationMs)}`}
      />
    </motion.section>
  );
}
