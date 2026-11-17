"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CorpusCard,
  DEFAULT_MODELS,
  DEFAULT_RULEBOOK,
  type ModelChoice,
  type Replay,
  type RulebookVersion,
  type RunSummary,
} from "../domain/contract";
import {
  listCorpus,
  listRuns,
  rulebookHistory,
  startRun,
  stopRun,
} from "../server/actions";
import { Hero } from "./hero";
import { isOver } from "./run-view";
import { Shelf, stackId } from "./shelf";
import "./sieve.css";
import { friendly } from "./ui";
import { UnderTheHood } from "./under-the-hood";
import type { Uploaded } from "./upload-zone";
import { useRun } from "./use-run";
import { type OpenDoc, ReplayComparison, Workspace } from "./workspace";

type Stage =
  | { kind: "home" }
  | { kind: "doc"; doc: OpenDoc; runId: string | null }
  | { kind: "replay"; replay: Replay };

const docOfCard = (card: CorpusCard): OpenDoc => ({
  source: { kind: "corpus", corpusId: card.id },
  title: card.title,
  genre: card.genre,
  pages: card.pages,
  expected: card.expectedNames,
  stack: stackId(card.id),
});

/**
 * Sieve, the Name Extraction demo. Shows before it tells: a recorded run
 * plays first, then the demo documents to open, preview and run, and the
 * result checked against the answer key. Depth lives under the hood.
 */
export function Sieve() {
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const [corpus, setCorpus] = useState<CorpusCard[] | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [rulebooks, setRulebooks] = useState<RulebookVersion[]>([]);
  const [models, setModels] = useState<ModelChoice>(DEFAULT_MODELS);
  const top = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const runId = stage.kind === "doc" ? stage.runId : null;
  const run = useRun(runId);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await listRuns());
      setRunsError(null);
    } catch (error) {
      setRunsError(friendly(error, "Past runs could not load."));
    }
  }, []);

  useEffect(() => {
    listCorpus().then(setCorpus, (error: unknown) =>
      setCorpusError(friendly(error, "The demo documents could not load.")),
    );
    void refreshRuns();
    rulebookHistory().then(setRulebooks, () => undefined);
  }, [refreshRuns]);

  const over = isOver(run.view.status);
  useEffect(() => {
    if (over && runId) void refreshRuns();
  }, [over, runId, refreshRuns]);

  const inFlight = (runs ?? []).find(
    (item) => item.status === "running" || item.status === "queued",
  );
  const busy =
    Boolean(inFlight && inFlight.id !== runId) ||
    (Boolean(runId) && !over && !run.missing && !run.loading);

  const go = (next: Stage) => {
    setStage(next);
    requestAnimationFrame(() =>
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const scrollToDocuments = () => {
    if (stage.kind !== "home") setStage({ kind: "home" });
    requestAnimationFrame(() =>
      document
        .getElementById("sv-documents")
        ?.scrollIntoView({ behavior: "smooth" }),
    );
  };

  const start = async (doc: OpenDoc) => {
    try {
      const result = await startRun({ source: doc.source, models });
      if ("error" in result) return result.error;
      setStage({ kind: "doc", doc, runId: result.runId });
      void refreshRuns();
      return null;
    } catch (error) {
      return friendly(error, "Sieve couldn't start a run.");
    }
  };

  const stop = async () => {
    if (!runId) return null;
    const result: unknown = await stopRun(runId);
    void refreshRuns();
    if (result && typeof result === "object" && "error" in result)
      return String((result as { error: unknown }).error);
    return null;
  };

  const openRun = (summary: RunSummary) => {
    const card =
      summary.source.kind === "corpus"
        ? corpus?.find(
            (item) =>
              item.id === (summary.source as { corpusId: string }).corpusId,
          )
        : undefined;
    go({
      kind: "doc",
      runId: summary.id,
      doc: card
        ? docOfCard(card)
        : {
            source: summary.source,
            title: summary.title,
            genre:
              summary.source.kind === "upload"
                ? "Your upload"
                : "Demo document",
            pages: summary.pages,
            expected: null,
            stack: `sv-run-${summary.id}`,
          },
    });
  };

  const onUploaded = (upload: Uploaded) =>
    go({
      kind: "doc",
      runId: null,
      doc: {
        source: { kind: "upload", uploadId: upload.uploadId },
        title: upload.title,
        genre: "Your upload",
        pages: upload.pages,
        expected: null,
        stack: `sv-upload-${upload.uploadId}`,
      },
    });

  const reviewBelow = useMemo(() => {
    const own = rulebooks.find(
      (item) => item.version === run.view.rulebookVersion,
    );
    const latest = rulebooks.reduce<RulebookVersion | undefined>(
      (best, item) => (!best || item.version > best.version ? item : best),
      undefined,
    );
    return (
      own?.rulebook.reviewBelow ??
      latest?.rulebook.reviewBelow ??
      DEFAULT_RULEBOOK.reviewBelow
    );
  }, [rulebooks, run.view.rulebookVersion]);

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-14 px-4 py-8 sm:px-6 sm:py-10">
      <nav className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="eyebrow text-federal-blue underline-offset-4 hover:underline"
        >
          ← Reljod Labs
        </Link>
        <a
          href="#sv-under-the-hood"
          className="eyebrow text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Under the hood ↓
        </a>
      </nav>

      <div ref={top} className="-mt-10 scroll-mt-6" />

      <AnimatePresence>
        {inFlight && stage.kind === "home" ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={() => openRun(inFlight)}
            className="press fixed right-4 bottom-4 z-30 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border-2 border-ink bg-paper px-4 py-2 text-sm font-semibold"
          >
            <span className="size-2 shrink-0 rounded-full bg-seal-red motion-safe:animate-pulse" />
            <span className="truncate">Run in progress: {inFlight.title}</span>
            <span className="text-federal-blue">Open →</span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <LayoutGroup>
        {stage.kind === "home" ? (
          <>
            <Hero
              onCompare={(replay) => go({ kind: "replay", replay })}
              onTry={scrollToDocuments}
              onUpload={() => uploadInput.current?.click()}
            />
            <Shelf
              corpus={corpus}
              error={corpusError}
              onOpen={(card) =>
                go({ kind: "doc", doc: docOfCard(card), runId: null })
              }
              onUploaded={onUploaded}
              uploadRef={uploadInput}
            />
          </>
        ) : stage.kind === "replay" ? (
          <ReplayComparison
            replay={stage.replay}
            onBack={scrollToDocuments}
            onRunIt={() => {
              const card = corpus?.find(
                (item) => item.id === stage.replay.corpusId,
              );
              if (card) go({ kind: "doc", doc: docOfCard(card), runId: null });
              else scrollToDocuments();
            }}
          />
        ) : (
          <Workspace
            key={`${stage.doc.stack}-${stage.runId ?? "preview"}`}
            doc={stage.doc}
            runId={stage.runId}
            run={run}
            busy={busy}
            reviewBelow={reviewBelow}
            onBack={scrollToDocuments}
            onStart={() => start(stage.doc)}
            onStop={stop}
          />
        )}
      </LayoutGroup>

      <UnderTheHood
        view={runId ? run.view : null}
        runId={runId}
        title={run.view.document?.title ?? "run"}
        runs={runs}
        runsError={runsError}
        models={models}
        onModels={setModels}
        onOpenRun={openRun}
        onRefreshRuns={() => void refreshRuns()}
        onRulesSaved={() => {
          rulebookHistory().then(setRulebooks, () => undefined);
        }}
      />
    </main>
  );
}
