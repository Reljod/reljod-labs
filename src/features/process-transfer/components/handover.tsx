"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DEMO_PATH } from "../domain/limits";
import type { DeskView } from "../domain/run";
import { loadDesk } from "../server/actions";
import { AuditTrail } from "./audit/audit-trail";
import { RunScreen } from "./convert/run-screen";
import { StartScreen } from "./convert/start";
import { usdCents } from "./format";
import { HANDOVER_TABS, type HandoverTab } from "./tabs";
import "./handover.css";
import { PipelineView } from "./pipeline/pipeline-view";
import { RulesEditor } from "./rules/rules-editor";
import { RunsList } from "./runs/runs-list";
import { buttonClass, InlineError, Skeleton, Tabs, tabPanelProps } from "./ui";

const TAB_LABEL: Record<HandoverTab, string> = {
  convert: "Convert",
  runs: "Runs",
  rules: "Rules",
  pipeline: "Pipeline",
  audit: "Audit",
};

/**
 * Handover: a recorded handover call in, a written Process, a workflow
 * document and an approved Deck out. Five tabs over one Desk; the address
 * keeps the tab and the open Run so a reload lands in the same place.
 */
export function Handover({
  initialTab,
  initialRunId,
}: {
  initialTab: HandoverTab;
  initialRunId: string | null;
}) {
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  const [tab, setTab] = useState<HandoverTab>(initialTab);
  const [runId, setRunId] = useState<string | null>(initialRunId);
  /** Bumped to load the open Run again (after a Redo of the same Run). */
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const view = await loadDesk();
      setDesk(view);
      setDeskError(null);
      return view;
    } catch (error) {
      setDeskError(
        error instanceof Error && error.message
          ? error.message
          : "The demo could not load your Runs and Rules.",
      );
      return null;
    }
  }, []);

  // First load: reattach to a Run still going if none is in the address.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on open
  useEffect(() => {
    void refresh().then((view) => {
      if (view?.activeRunId && !initialRunId) setRunId(view.activeRunId);
    });
  }, []);

  // The address follows the tab and the open Run.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "convert") params.set("tab", tab);
    if (runId) params.set("run", runId);
    const query = params.toString();
    const next = `${DEMO_PATH}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [tab, runId]);

  const openRun = useCallback((id: string) => {
    setRunId(id);
    setGeneration((value) => value + 1);
    setTab("convert");
    window.scrollTo({ top: 0 });
  }, []);

  const started = useCallback(
    (id: string) => {
      openRun(id);
      void refresh();
    },
    [openRun, refresh],
  );

  const closeRun = useCallback(() => setRunId(null), []);
  const onEnded = useCallback(() => void refresh(), [refresh]);

  return (
    <div className="ho-ground flex min-h-dvh flex-col text-ink">
      <header className="border-ink border-b-2 bg-paper">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 pt-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href="/#demos"
                className="whitespace-nowrap font-mono text-[11px] font-bold tracking-[0.1em] text-ink-muted uppercase hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
              >
                ← Labs
              </Link>
              <span aria-hidden="true" className="h-8 w-0.5 bg-ink/20" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-mono text-lg font-bold tracking-[0.12em] uppercase">
                    Handover
                  </h1>
                  <span className="rounded-sm border border-seal-red/60 px-1.5 py-px font-mono text-[10px] font-bold tracking-[0.08em] text-seal-red uppercase">
                    Synthetic data
                  </span>
                </div>
                <p className="hidden text-sm text-ink-muted sm:block">
                  A recorded handover call becomes a written process, a workflow
                  document and a checked slide deck.
                </p>
              </div>
            </div>
            <SpendMeter spend={desk?.spend ?? null} />
          </div>
          <Tabs<HandoverTab>
            id="ho"
            label="Handover"
            value={tab}
            onChange={setTab}
            items={HANDOVER_TABS.map((id) => ({
              id,
              label: TAB_LABEL[id],
              badge:
                id === "runs" && desk && desk.runs.length > 0
                  ? desk.runs.length
                  : undefined,
            }))}
            className="-mb-0.5 pb-2"
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        <div {...tabPanelProps("ho", tab)}>
          {deskError && !desk && !(tab === "convert" && runId) ? (
            <DeskFailed error={deskError} onRetry={() => void refresh()} />
          ) : tab === "convert" ? (
            runId ? (
              <RunScreen
                runId={runId}
                generation={generation}
                currentRulesVersion={desk?.rulesVersion ?? 0}
                onClose={closeRun}
                onRedone={(id) => {
                  openRun(id);
                  void refresh();
                }}
                onEnded={onEnded}
              />
            ) : desk ? (
              <StartScreen desk={desk} onStarted={started} />
            ) : (
              <DeskLoading />
            )
          ) : !desk ? (
            <DeskLoading />
          ) : tab === "runs" ? (
            <RunsList
              runs={desk.runs}
              openId={runId}
              onOpen={openRun}
              onNew={() => {
                closeRun();
                setTab("convert");
              }}
            />
          ) : tab === "rules" ? (
            <RulesEditor
              rules={desk.rules}
              rulesVersion={desk.rulesVersion}
              onSaved={(saved) =>
                setDesk((current) =>
                  current
                    ? {
                        ...current,
                        rules: saved.rules,
                        ruleOverrides: saved.ruleOverrides,
                        rulesVersion: saved.rulesVersion,
                      }
                    : current,
                )
              }
            />
          ) : tab === "pipeline" ? (
            <PipelineView
              models={desk.models}
              rules={desk.rules}
              onModelsSaved={(models) =>
                setDesk((current) =>
                  current ? { ...current, models } : current,
                )
              }
            />
          ) : (
            <AuditTrail openRunId={runId} />
          )}
        </div>
      </main>
    </div>
  );
}

/** "$0.04 of $1.50 today", with a bar, and the Runs left this hour. */
function SpendMeter({ spend }: { spend: DeskView["spend"] | null }) {
  if (!spend) {
    return (
      <div className="ho-shimmer h-10 w-48 rounded-sm" aria-hidden="true" />
    );
  }
  const share =
    spend.capUsd > 0 ? Math.min(1, spend.todayUsd / spend.capUsd) : 0;
  return (
    <div className="flex min-w-[12rem] flex-col gap-1">
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span>
          <span className="font-mono font-bold">
            {usdCents(spend.todayUsd)}
          </span>
          <span className="text-ink-muted">
            {" "}
            of {usdCents(spend.capUsd)} today
          </span>
        </span>
        <span className="font-mono text-[11px] text-ink-muted">
          {spend.runsLeftThisHour}{" "}
          {spend.runsLeftThisHour === 1 ? "Run" : "Runs"} left this hour
        </span>
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot take the Colonnade outline and colours across browsers */}
      <div
        role="meter"
        aria-label="Spend today"
        aria-valuemin={0}
        aria-valuemax={spend.capUsd}
        aria-valuenow={spend.todayUsd}
        aria-valuetext={`${usdCents(spend.todayUsd)} of ${usdCents(spend.capUsd)} today`}
        className="h-2 w-full overflow-hidden rounded-sm border border-ink bg-marble"
      >
        <div
          className={`h-full ${share >= 1 ? "bg-seal-red" : share >= 0.8 ? "bg-brass" : "bg-federal-blue"}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}

function DeskLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only" aria-live="polite">
        Loading…
      </span>
      <Skeleton lines={2} className="max-w-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="ho-shimmer aspect-video rounded-sm" />
        ))}
      </div>
    </div>
  );
}

function DeskFailed({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-3">
      <p className="font-mono text-lg font-bold uppercase">
        The demo did not load
      </p>
      <InlineError>{error}</InlineError>
      <button type="button" onClick={onRetry} className={buttonClass}>
        Try again
      </button>
    </div>
  );
}
