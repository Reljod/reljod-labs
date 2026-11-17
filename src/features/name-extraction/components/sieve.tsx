"use client";

import { LayoutGroup } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoBar, demoBarControlClass } from "@/components/demo/demo-bar";
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

/**
 * Sieve, the Name Extraction demo. Shows before it tells: a recorded run
 * plays first, then the demo documents to open, preview and run, and the
 * result checked against the answer key. Depth lives under the hood.
 */
export function Sieve() {
  const [tab, setTab] = useState<Tab>("demo");
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const [replay, setReplay] = useState<Replay | null>(null);
  const [corpus, setCorpus] = useState<CorpusCard[] | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [rulebooks, setRulebooks] = useState<RulebookVersion[]>([]);
  const [models, setModels] = useState<ModelChoice>(DEFAULT_MODELS);
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
    try {
      const result = await startRun({ source: doc.source, models });
      if ("error" in result) return result.error;
      setStage({ kind: "doc", doc, runId: result.runId });
      setTab("documents");
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
                  const card = corpus?.find(
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
                error={corpusError}
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
            onRulesSaved={() => {
              rulebookHistory().then(setRulebooks, () => undefined);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
