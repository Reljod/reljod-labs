"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CorpusCard,
  DEFAULT_RULEBOOK,
  type DocumentSource,
  type ModelChoice,
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
import { AuditLog } from "./audit-log";
import { DocumentPicker } from "./document-picker";
import { HowBuilt } from "./how-built";
import { RegisterTable } from "./register-table";
import { RulesEditor } from "./rules-editor";
import { ScorePanel, UsedPanel } from "./run-facts";
import { RunPanel } from "./run-panel";
import { isOver, liveNodes, nodeCounts } from "./run-view";
import { RunsHistory } from "./runs-history";
import "./sieve.css";
import { cx } from "./ui";
import { useRun } from "./use-run";

const TABS = [
  { id: "run", label: "Run" },
  { id: "audit", label: "Audit" },
  { id: "rules", label: "Rules" },
  { id: "runs", label: "Runs" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/**
 * Sieve, the Name Extraction demo: how it is built, the document picker, the
 * open Run (timeline, Readers, Done gate, cost, Register, Score), its Audit
 * trail, the Rulebook and past Runs.
 */
export function Sieve() {
  const [tab, setTab] = useState<TabId>("run");
  const [corpus, setCorpus] = useState<CorpusCard[] | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [rulebooks, setRulebooks] = useState<RulebookVersion[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const runRef = useRef<HTMLDivElement>(null);
  const { view, loading, missing } = useRun(openId);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await listRuns());
      setRunsError(null);
    } catch (error) {
      setRunsError(message(error, "The runs could not load."));
    }
  }, []);

  const refreshRulebooks = useCallback(async () => {
    try {
      setRulebooks(await rulebookHistory());
    } catch {
      // The Register falls back to the default threshold.
    }
  }, []);

  useEffect(() => {
    listCorpus().then(
      (cards) => setCorpus(cards),
      (error: unknown) =>
        setCorpusError(message(error, "The corpus could not load.")),
    );
    void refreshRuns();
    void refreshRulebooks();
  }, [refreshRuns, refreshRulebooks]);

  // Open the latest Run once, so a reload lands where the person was.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !runs) return;
    opened.current = true;
    if (runs[0]) setOpenId(runs[0].id);
  }, [runs]);

  // When the open Run ends, the history learns its cost and score.
  const over = isOver(view.status);
  useEffect(() => {
    if (over && openId) void refreshRuns();
  }, [over, openId, refreshRuns]);

  const live = Boolean(openId) && !loading && !missing && !over;
  const busy =
    live ||
    (runs ?? []).some(
      (run) => run.status === "running" || run.status === "queued",
    );

  const start = async (input: {
    source: DocumentSource;
    models: ModelChoice;
  }) => {
    const result = await startRun(input);
    if ("error" in result) return result.error;
    setOpenId(result.runId);
    setTab("run");
    void refreshRuns();
    requestAnimationFrame(() =>
      runRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return null;
  };

  const stop = async () => {
    if (!openId) return null;
    const result: unknown = await stopRun(openId);
    void refreshRuns();
    if (result && typeof result === "object" && "error" in result)
      return String((result as { error: unknown }).error);
    return null;
  };

  const reviewBelow = useMemo(() => {
    const version = rulebooks.find(
      (item) => item.version === view.rulebookVersion,
    );
    // A Run's own version, else the latest (the history's order is not assumed).
    const latest = rulebooks.reduce<RulebookVersion | undefined>(
      (best, item) => (!best || item.version > best.version ? item : best),
      undefined,
    );
    return (
      version?.rulebook.reviewBelow ??
      latest?.rulebook.reviewBelow ??
      DEFAULT_RULEBOOK.reviewBelow
    );
  }, [rulebooks, view.rulebookVersion]);

  const lit = useMemo(() => liveNodes(view), [view]);
  const counts = useMemo(() => nodeCounts(view), [view]);
  const title = view.document?.title ?? "run";

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        <Link href="/" className="eyebrow text-federal-blue underline">
          ← Reljod Labs
        </Link>
        <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
          Sieve
        </h1>
        <p className="max-w-3xl text-[1.05rem] leading-relaxed">
          Finds every party a long AML document names, with every alias and
          every page, from 10 to 500 pages. Recall first: a missed name is a
          missed screening hit, an extra one costs an analyst one look.
        </p>
      </header>

      <HowBuilt
        live={lit}
        counts={counts}
        running={live}
        loaded={view.skills}
      />

      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label="Sieve"
          className="flex flex-wrap gap-1 border-ink/15 border-b"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`sv-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`sv-panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={cx(
                "-mb-px border-b-2 px-3 py-2 font-mono text-xs font-bold tracking-[0.1em] uppercase",
                tab === item.id
                  ? "border-federal-blue text-federal-blue"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {item.label}
              {item.id === "audit" && view.events.length > 0 ? (
                <span className="ml-1 font-normal">{view.events.length}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`sv-panel-${tab}`}
          aria-labelledby={`sv-tab-${tab}`}
          className="flex flex-col gap-4"
        >
          {tab === "run" ? (
            <>
              <DocumentPicker
                corpus={corpus}
                corpusError={corpusError}
                busy={busy}
                onStart={start}
              />
              <div ref={runRef} className="flex flex-col gap-4">
                {openId === null ? null : loading ? (
                  <p className="text-sm text-ink-muted">Opening the run…</p>
                ) : missing ? (
                  <p className="text-sm text-ink-muted">
                    That run is not on your account.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                      <RunPanel key={openId} view={view} onStop={stop} />
                      <div className="flex flex-col gap-4">
                        {view.score ? <ScorePanel score={view.score} /> : null}
                        <UsedPanel view={view} />
                      </div>
                    </div>
                    <RegisterTable
                      names={view.names}
                      reviewBelow={reviewBelow}
                      title={title}
                    />
                  </>
                )}
              </div>
            </>
          ) : null}

          {tab === "audit" ? (
            openId && !missing ? (
              <AuditLog events={view.events} runId={openId} title={title} />
            ) : (
              <p className="text-sm text-ink-muted">
                Open a run to read its audit trail.
              </p>
            )
          ) : null}

          {tab === "rules" ? (
            <RulesEditor onSaved={() => void refreshRulebooks()} />
          ) : null}

          {tab === "runs" ? (
            <RunsHistory
              runs={runs}
              error={runsError}
              openId={openId}
              onRefresh={() => void refreshRuns()}
              onOpen={(runId) => {
                setOpenId(runId);
                setTab("run");
              }}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
