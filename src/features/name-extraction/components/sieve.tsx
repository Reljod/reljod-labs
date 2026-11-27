"use client";

import { LayoutGroup } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoBar, demoBarControlClass } from "@/components/demo/demo-bar";
import { apiPath } from "../domain/api";
import {
  type CorpusCard,
  DEFAULT_MODELS,
  DEFAULT_RULEBOOK,
  type ModelChoice,
  type Replay,
  type RulebookVersion,
  type RunSummary,
} from "../domain/contract";
import { api, writes } from "./api";
import { Hero } from "./hero";
import { isRulebookPreview, PREVIEW_MAX_AGE_MS, reads } from "./read-cache";
import { isOver } from "./run-view";
import { Shelf, stackId } from "./shelf";
import "./sieve.css";
import { friendly } from "./ui";
import { UnderTheHood } from "./under-the-hood";
import type { Uploaded } from "./upload-zone";
import { prefetchFirstPages } from "./use-pages";
import { forgetFinishedRuns, useRun } from "./use-run";
import { type OpenDoc, ReplayComparison, Workspace } from "./workspace";

type Stage =
  | { kind: "home" }
  | { kind: "doc"; doc: OpenDoc; runId: string | null };

/** Sieve's places, as tabs in the shared demo bar. */
const TABS = [
  { id: "demo", label: "Demo" },
  { id: "documents", label: "Documents" },
  { id: "hood", label: "Under the hood" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const docOfCard = (card: CorpusCard): OpenDoc => ({
  source: { kind: "corpus", corpusId: card.id },
  title: card.title,
  genre: card.genre,
  pages: card.pages,
  expected: card.expectedNames,
  stack: stackId(card.id),
});

/** Starts loading what opening a demo Document shows first: its names and first pages. */
function prefetchDocument(card: CorpusCard) {
  const source = { kind: "corpus", corpusId: card.id } as const;
  void reads
    .get(apiPath.overview(source), PREVIEW_MAX_AGE_MS)
    .catch(() => undefined);
  prefetchFirstPages(source, card.pages);
}

/** Starts loading a finished Run's result alongside the Run itself. */
function prefetchResult(summary: RunSummary) {
  if (!isOver(summary.status)) return;
  void reads
    .get(
      summary.source.kind === "corpus"
        ? apiPath.comparison(summary.id)
        : apiPath.overview(summary.source, summary.id),
    )
    .catch(() => undefined);
  prefetchFirstPages(summary.source, summary.pages, summary.id);
}

/**
 * Sieve, the Name Extraction demo. Shows before it tells: a recorded run
 * plays first, then the demo documents to open, preview and run, and the
 * result checked against the answer key. Depth lives under the hood.
 */
export function Sieve({
  corpus,
  initialRuns,
  initialRulebooks,
}: {
  /** The demo Documents: seed data, rendered with the page. */
  corpus: CorpusCard[];
  /** The Owner's Runs, read with the page; null if they could not be. */
  initialRuns: RunSummary[] | null;
  /** The Owner's Rulebook versions, read with the page; null if they could not be. */
  initialRulebooks: RulebookVersion[] | null;
}) {
  const [tab, setTab] = useState<Tab>("demo");
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const [replay, setReplay] = useState<Replay | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(initialRuns);
  const [runsError, setRunsError] = useState<string | null>(
    initialRuns ? null : "Past runs could not load.",
  );
  const [rulebooks, setRulebooks] = useState<RulebookVersion[]>(
    initialRulebooks ?? [],
  );
  const [models, setModels] = useState<ModelChoice>(DEFAULT_MODELS);
  const uploadInput = useRef<HTMLInputElement>(null);
  const runId = stage.kind === "doc" ? stage.runId : null;
  const run = useRun(runId);

  // One list refresh at a time: a newer one aborts the older, so a slow
  // answer never lands over a fresher one.
  const runsRequest = useRef<AbortController | null>(null);
  const refreshRuns = useCallback(async () => {
    runsRequest.current?.abort();
    const controller = new AbortController();
    runsRequest.current = controller;
    try {
      const next = await api.runs({ signal: controller.signal });
      setRuns(next);
      setRunsError(null);
    } catch (error) {
      if (!controller.signal.aborted)
        setRunsError(friendly(error, "Past runs could not load."));
    }
  }, []);

  // The page's read cache lives as long as Sieve does.
  useEffect(
    () => () => {
      runsRequest.current?.abort();
      reads.clear();
      forgetFinishedRuns();
    },
    [],
  );

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

  const toTop = () =>
    requestAnimationFrame(() =>
      window.scrollTo({ top: 0, behavior: "smooth" }),
    );
  /** Opens the Documents tab on a document, or on the list. */
  const go = (next: Stage) => {
    setStage(next);
    setTab("documents");
    toTop();
  };
  const toDocuments = () => go({ kind: "home" });
  const select = (next: Tab) => {
    // Choosing the open tab again goes back to its start (the list, the hero).
    if (next === tab) {
      if (next === "documents") setStage({ kind: "home" });
      if (next === "demo") setReplay(null);
    }
    setTab(next);
    toTop();
  };

  const start = async (doc: OpenDoc) => {
    const result = await writes.startRun({ source: doc.source, models });
    if (!result.ok)
      return friendly(result.error, "Sieve couldn't start a run.");
    setStage({ kind: "doc", doc, runId: result.value.runId });
    setTab("documents");
    void refreshRuns();
    return null;
  };

  const stop = async () => {
    if (!runId) return null;
    const result = await writes.stopRun(runId);
    void refreshRuns();
    return result.ok ? null : result.error;
  };

  const openRun = (summary: RunSummary) => {
    prefetchResult(summary);
    const card =
      summary.source.kind === "corpus"
        ? corpus.find(
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
    <div className="flex min-h-dvh flex-col">
      <DemoBar
        slug="name-extraction"
        name="Sieve"
        current={tab}
        panelsId="sv"
        tabs={TABS.map((item) => ({
          id: item.id,
          label: item.label,
          onSelect: () => select(item.id),
        }))}
      >
        {inFlight ? (
          <button
            type="button"
            onClick={() => openRun(inFlight)}
            title={`Open the run in progress: ${inFlight.title}`}
            className={demoBarControlClass}
          >
            <span className="size-2 shrink-0 bg-seal-red motion-safe:animate-pulse" />
            Live run
          </button>
        ) : null}
      </DemoBar>

      <main
        id={`sv-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`sv-tab-${tab}`}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-14 px-4 py-8 sm:px-6 sm:py-10"
      >
        <LayoutGroup>
          {tab === "demo" ? (
            replay ? (
              <ReplayComparison
                replay={replay}
                onRunIt={() => {
                  const card = corpus.find(
                    (item) => item.id === replay.corpusId,
                  );
                  if (card)
                    go({ kind: "doc", doc: docOfCard(card), runId: null });
                  else toDocuments();
                }}
              />
            ) : (
              <Hero
                onCompare={(next) => {
                  setReplay(next);
                  toTop();
                }}
                onTry={toDocuments}
                onUpload={() => {
                  toDocuments();
                  setTimeout(() => uploadInput.current?.click(), 50);
                }}
              />
            )
          ) : null}
          {tab === "documents" ? (
            stage.kind === "home" ? (
              <Shelf
                corpus={corpus}
                onIntent={prefetchDocument}
                onOpen={(card) =>
                  go({ kind: "doc", doc: docOfCard(card), runId: null })
                }
                onUploaded={onUploaded}
                uploadRef={uploadInput}
              />
            ) : (
              <Workspace
                key={`${stage.doc.stack}-${stage.runId ?? "preview"}`}
                doc={stage.doc}
                runId={stage.runId}
                run={run}
                busy={busy}
                reviewBelow={reviewBelow}
                onStart={() => start(stage.doc)}
                onStop={stop}
              />
            )
          ) : null}
        </LayoutGroup>
        {tab === "hood" ? (
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
            rulebooks={rulebooks}
            onRulesSaved={(saved) => {
              // Previews mark names under the current Rulebook: drop the old ones.
              reads.forget(isRulebookPreview);
              // The save answered with the version it wrote: no second read.
              setRulebooks((list) => [
                saved,
                ...list.filter((item) => item.version !== saved.version),
              ]);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
