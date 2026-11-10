"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTokens, formatUsd, runTotals } from "../../metrics";
import { findPack } from "../../packs";
import { DOCUMENT_ORDER } from "../../scan-events";
import { getRun } from "../../server/actions";
import type { RunView } from "../../view";
import { Caveats } from "../caveats";
import { DOCUMENT_LABELS } from "../labels";
import { SESSION_RUNS_KEY, SessionRuns } from "../session-runs";
import { ProgressRail } from "./progress-rail";
import { RunResults } from "./run-results";
import { ScanStage } from "./scan-stage";
import { Terminal } from "./terminal";
import { usePlayhead } from "./use-playhead";
import { type FeedSource, useScanFeed } from "./use-scan-feed";

type Mode = "live" | "replay" | "results";

const isFinished = (view: RunView) =>
  view.status === "completed" || view.status === "failed";

/** One Pre-screen run: the live (or replayed) scan, then its Findings. */
export function RunScreen({ runId }: { runId: string }) {
  const replayParam = useSearchParams().get("replay");
  const reduceMotion = useReducedMotion() ?? false;
  const queryClient = useQueryClient();
  const queryKey = ["prescreen-run", runId];
  const run = useQuery({ queryKey, queryFn: () => getRun(runId) });
  const view = run.data ?? null;

  const [mode, setMode] = useState<Mode | null>(null);
  const [replay, setReplay] = useState<{ view: RunView; key: number } | null>(
    null,
  );

  // The mode is decided once, from how the run looked when the page opened.
  useEffect(() => {
    if (!view || mode) return;
    if (!isFinished(view)) setMode("live");
    else if (replayParam) {
      setReplay({ view, key: 1 });
      setMode("replay");
    } else setMode("results");
  }, [view, mode, replayParam]);

  const source: FeedSource =
    mode === "live"
      ? { mode: "live", runId }
      : mode === "replay" && replay
        ? { mode: "replay", view: replay.view, key: replay.key }
        : { mode: "idle" };
  const scan = useScanFeed(source);

  const pack = view ? findPack(view.packSlug) : undefined;
  const kinds = DOCUMENT_ORDER.filter((kind) =>
    pack?.documents.some((document) => document.kind === kind),
  );
  const { head, skip, pin, follow } = usePlayhead(scan, kinds, {
    tickMs: reduceMotion ? 120 : 380,
    resetKey: `${mode}-${replay?.key ?? 0}`,
  });

  // A live run that has ended: load what it stored.
  const ended = scan.end !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch once per run end
  useEffect(() => {
    if (ended && mode === "live") {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: SESSION_RUNS_KEY });
    }
  }, [ended, mode]);

  useEffect(() => {
    if (
      mode !== "results" &&
      head.finished &&
      ended &&
      view &&
      isFinished(view)
    ) {
      setMode("results");
    }
  }, [mode, head.finished, ended, view]);

  if (run.isError || (run.isSuccess && !view)) {
    return (
      <p role="alert" className="outline-box rounded-sm bg-limestone px-4 py-3">
        ✕ {run.error?.message ?? "No such run."}
      </p>
    );
  }
  if (!view || !pack || !mode) return <RunSkeleton />;

  const scanning = mode !== "results";
  const kind = head.onScreen ?? kinds[0];
  const document = pack.documents.find((item) => item.kind === kind);
  const totals = runTotals(kinds.map((item) => scan.documents[item].usage));
  const allRead = kinds.every(
    (item) =>
      scan.documents[item].checks !== null ||
      scan.documents[item].stages.read === "error",
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/demos/document-compliance"
          aria-label="Back to document packs"
          className="outline-box press grid size-10 place-items-center rounded-sm bg-paper font-mono font-bold"
        >
          ←
        </Link>
        <h1 className="font-mono text-xl font-bold uppercase sm:text-2xl">
          {pack.title}
        </h1>
        <ModeBadge mode={mode} ended={ended} />
        {scanning &&
        (mode === "live" ||
          kinds.some((item) => scan.documents[item].usage)) ? (
          <span
            data-testid="live-cost"
            className="eyebrow rounded-sm border border-ink bg-paper px-2 py-1"
            title={`${formatTokens(totals.inputTokens)} input · ${formatTokens(totals.outputTokens)} output tokens`}
          >
            {formatUsd(totals.costUsd ?? (totals.inputTokens ? null : 0))} ·{" "}
            {formatTokens(totals.inputTokens + totals.outputTokens)} tok
          </span>
        ) : null}
        <span className="ml-auto flex gap-2">
          {scanning && (ended || mode === "replay") && !head.finished ? (
            <button
              type="button"
              data-testid="skip-scan"
              onClick={skip}
              className="outline-box press min-h-10 rounded-sm bg-paper px-3 font-mono text-xs font-bold uppercase"
            >
              {head.pinned && allRead && ended ? "Findings ▸▸" : "Skip ▸▸"}
            </button>
          ) : null}
          {mode === "results" && view.status === "completed" ? (
            <button
              type="button"
              data-testid="replay-scan"
              onClick={() => {
                setReplay((current) => ({
                  view,
                  key: (current?.key ?? 0) + 1,
                }));
                setMode("replay");
              }}
              className="outline-box press min-h-10 rounded-sm bg-paper px-3 font-mono text-xs font-bold uppercase"
            >
              ↺ Replay scan
            </button>
          ) : null}
        </span>
      </header>

      {replayParam === "limited" ? (
        <p
          data-testid="run-notice"
          className="eyebrow self-start rounded-sm bg-brass px-2 py-1 text-ink"
        >
          Live limit reached · stored run
        </p>
      ) : null}

      <AnimatePresence mode="wait">
        {scanning ? (
          <motion.div
            key="scan"
            exit={reduceMotion ? undefined : { opacity: 0, y: -16 }}
            className="flex flex-col gap-6"
          >
            <ProgressRail
              pack={pack}
              kinds={kinds}
              documents={scan.documents}
              onScreen={head.finished ? null : kind}
              onSelect={pin}
              reduceMotion={reduceMotion}
            />
            <div
              data-testid="scan-follow"
              data-pinned={head.pinned}
              className="-mt-2 flex min-h-8 flex-wrap items-center gap-2 font-mono text-xs text-ink-muted"
            >
              {head.pinned ? (
                <>
                  <span>
                    Pinned to the {DOCUMENT_LABELS[kind].toLowerCase()}. Pick
                    any Document above to look at it.
                  </span>
                  <button
                    type="button"
                    data-testid="follow-run"
                    onClick={follow}
                    className="outline-box press rounded-sm bg-paper px-2 py-1 font-bold text-ink uppercase"
                  >
                    Follow run ▸
                  </button>
                </>
              ) : (
                <span>
                  Following the run: each Document comes on screen as soon as it
                  has output. Pick one above to stay on it.
                </span>
              )}
            </div>
            {kind && document ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={kind}
                  initial={reduceMotion ? false : { opacity: 0, x: 60 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, x: -60 }}
                  transition={{ type: "spring", stiffness: 200, damping: 26 }}
                >
                  <ScanStage
                    packSlug={pack.slug}
                    pack={document}
                    scan={scan.documents[kind]}
                    play={head.documents[kind]}
                    reduceMotion={reduceMotion}
                  />
                </motion.div>
              </AnimatePresence>
            ) : null}
          </motion.div>
        ) : (
          <motion.div
            key="results"
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <RunResults view={view} reduceMotion={reduceMotion} />
          </motion.div>
        )}
      </AnimatePresence>

      <Terminal
        title={`prescreen · ${pack.slug} · ${view.model ?? "model"} · ${view.prescreenDate}`}
        lines={scan.log}
        live={mode === "live" && !ended}
        reduceMotion={reduceMotion}
      />

      <SessionRuns currentRunId={runId} />

      <Caveats />
    </div>
  );
}

function ModeBadge({ mode, ended }: { mode: Mode; ended: boolean }) {
  if (mode === "live" && !ended) {
    return (
      <span className="eyebrow flex items-center gap-1.5 rounded-sm bg-seal-red px-2 py-1 text-paper">
        <span className="size-1.5 animate-pulse rounded-full bg-paper" />
        Live
      </span>
    );
  }
  if (mode === "replay") {
    return (
      <span className="eyebrow rounded-sm bg-federal-blue px-2 py-1 text-paper">
        ↺ Replay
      </span>
    );
  }
  return (
    <span className="eyebrow rounded-sm bg-ink px-2 py-1 text-paper">
      ✓ Done
    </span>
  );
}

export function RunSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy>
      <div className="h-10 w-64 rounded-sm bg-limestone" />
      <div className="grid grid-cols-3 gap-4">
        <div className="h-16 rounded-sm bg-limestone" />
        <div className="h-16 rounded-sm bg-limestone" />
        <div className="h-16 rounded-sm bg-limestone" />
      </div>
      <div className="aspect-[4/3] max-w-2xl rounded-sm bg-limestone" />
    </div>
  );
}
