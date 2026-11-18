"use client";

import dynamic from "next/dynamic";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { DemoBar, DemoBarBadge } from "@/components/demo/demo-bar";
import type { Loaded } from "../domain/api";
import { DEMO_PATH } from "../domain/limits";
import type { DeskView, RunView } from "../domain/run";
import { fetchDesk, fetchRun } from "./api";
import { RunScreen } from "./convert/run-screen";
import { StartScreen } from "./convert/start";
import { usdCents } from "./format";
import { HANDOVER_TABS, type HandoverTab } from "./tabs";
import "./handover.css";
import { DeskSkeleton } from "./desk-skeleton";
import { runPrefetch } from "./run-prefetch";
import { RunsList } from "./runs/runs-list";
import { buttonClass, InlineError, Skeleton, tabPanelProps } from "./ui";

/*
 * The tabs a visitor opens less often load on demand; `warmTabs` fetches
 * their code once the page is idle, so a switch rarely waits for it.
 */
const loadRules = () => import("./rules/rules-editor");
const loadPipeline = () => import("./pipeline/pipeline-view");
const loadAudit = () => import("./audit/audit-trail");
const TabLoading = () => (
  <div className="outline-box rounded-sm bg-paper p-4" aria-busy="true">
    <span className="sr-only" aria-live="polite">
      Loading…
    </span>
    <Skeleton lines={8} />
  </div>
);
const RulesEditor = dynamic(() => loadRules().then((m) => m.RulesEditor), {
  loading: TabLoading,
});
const PipelineView = dynamic(() => loadPipeline().then((m) => m.PipelineView), {
  loading: TabLoading,
});
const AuditTrail = dynamic(() => loadAudit().then((m) => m.AuditTrail), {
  loading: TabLoading,
});
const TAB_CODE: Partial<Record<HandoverTab, () => Promise<unknown>>> = {
  rules: loadRules,
  pipeline: loadPipeline,
  audit: loadAudit,
};
function warmTabs() {
  for (const load of Object.values(TAB_CODE)) void load?.().catch(() => {});
}

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
  initialDesk,
  initialRun,
}: {
  initialTab: HandoverTab;
  initialRunId: string | null;
  /** Read by the page on the server; the browser does not read it again on open. */
  initialDesk: Loaded<DeskView>;
  /** The Run in the address, read alongside the Desk. */
  initialRun: Loaded<RunView | null> | null;
}) {
  const [desk, setDesk] = useState<DeskView | null>(
    initialDesk.ok ? initialDesk.value : null,
  );
  const [deskError, setDeskError] = useState<string | null>(
    initialDesk.ok ? null : initialDesk.error,
  );
  const [tab, setTab] = useState<HandoverTab>(initialTab);
  // Reattach to a Run still going if none is in the address.
  const [runId, setRunId] = useState<string | null>(
    initialRunId ??
      (initialDesk.ok ? initialDesk.value.activeRunId : null) ??
      null,
  );
  /** Bumped to load the open Run again (after a Redo of the same Run). */
  const [generation, setGeneration] = useState(0);
  /** Tabs opened so far stay mounted (hidden), so going back is instant. */
  const [visited, setVisited] = useState<ReadonlySet<HandoverTab>>(
    () => new Set([initialTab]),
  );

  /** Reads of Runs started early: the page's own, and on hover in Runs. */
  const [prefetch] = useState(() => {
    const cache = runPrefetch((id) => fetchRun(id));
    if (initialRunId && initialRun) {
      cache.seed(
        initialRunId,
        initialRun.ok
          ? Promise.resolve(initialRun.value)
          : Promise.reject(new Error(initialRun.error)),
      );
    }
    return cache;
  });

  /** Only the newest Desk read may land; an older one is dropped. */
  const deskRead = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    deskRead.current?.abort();
    const controller = new AbortController();
    deskRead.current = controller;
    try {
      const view = await fetchDesk(controller.signal);
      if (controller.signal.aborted) return null;
      setDesk(view);
      setDeskError(null);
      return view;
    } catch (error) {
      if (controller.signal.aborted) return null;
      setDeskError(
        error instanceof Error && error.message
          ? error.message
          : "The demo could not load your Runs and Rules.",
      );
      return null;
    }
  }, []);
  useEffect(() => () => deskRead.current?.abort(), []);

  // Fetch the other tabs' code once the first view has painted.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run) => setTimeout(run, 1500));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const handle = idle(warmTabs);
    return () => cancel(handle as number);
  }, []);

  const select = useCallback((next: HandoverTab) => {
    setTab(next);
    setVisited((seen) => (seen.has(next) ? seen : new Set(seen).add(next)));
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

  const openRun = useCallback(
    (id: string) => {
      setRunId(id);
      setGeneration((value) => value + 1);
      select("convert");
      window.scrollTo({ top: 0 });
    },
    [select],
  );

  const started = useCallback(
    (id: string) => {
      openRun(id);
      void refresh();
    },
    [openRun, refresh],
  );

  const closeRun = useCallback(() => setRunId(null), []);
  const onEnded = useCallback(() => void refresh(), [refresh]);
  const takeRun = useCallback((id: string) => prefetch.take(id), [prefetch]);

  const failed = deskError && !desk;
  const panel = (id: HandoverTab, content: ReactNode) =>
    visited.has(id) || id === tab ? (
      <div key={id} {...tabPanelProps("ho", id)} hidden={id !== tab}>
        {content}
      </div>
    ) : null;

  return (
    <div className="ho-ground flex min-h-dvh flex-col text-ink">
      <DemoBar
        slug="process-transfer"
        name="Handover"
        titleAs="h1"
        badge={<DemoBarBadge>Synthetic data</DemoBarBadge>}
        current={tab}
        panelsId="ho"
        tabs={HANDOVER_TABS.map((id) => ({
          id,
          label: TAB_LABEL[id],
          badge:
            id === "runs" && desk && desk.runs.length > 0
              ? desk.runs.length
              : undefined,
          onSelect: () => select(id),
        }))}
      >
        <SpendMeter spend={desk?.spend ?? null} />
      </DemoBar>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        {panel(
          "convert",
          runId ? (
            <RunScreen
              runId={runId}
              generation={generation}
              visible={tab === "convert"}
              preloaded={takeRun}
              currentRulesVersion={desk?.rulesVersion ?? 0}
              onClose={closeRun}
              onRedone={(id) => {
                prefetch.drop(id);
                openRun(id);
                void refresh();
              }}
              onEnded={onEnded}
            />
          ) : failed ? (
            <DeskFailed error={deskError} onRetry={() => void refresh()} />
          ) : desk ? (
            <StartScreen desk={desk} onStarted={started} />
          ) : (
            <DeskSkeleton />
          ),
        )}
        {failed && tab !== "convert" ? (
          panel(
            tab,
            <DeskFailed error={deskError} onRetry={() => void refresh()} />,
          )
        ) : desk ? (
          <>
            {panel(
              "runs",
              <RunsList
                runs={desk.runs}
                openId={runId}
                onOpen={openRun}
                onIntent={prefetch.prefetch}
                onNew={() => {
                  closeRun();
                  select("convert");
                }}
              />,
            )}
            {panel(
              "rules",
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
              />,
            )}
            {panel(
              "pipeline",
              <PipelineView
                models={desk.models}
                rules={desk.rules}
                onModelsSaved={(models) =>
                  setDesk((current) =>
                    current ? { ...current, models } : current,
                  )
                }
              />,
            )}
            {panel(
              "audit",
              <AuditTrail openRunId={runId} active={tab === "audit"} />,
            )}
          </>
        ) : tab !== "convert" ? (
          panel(tab, <DeskSkeleton />)
        ) : null}
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
    <div className="flex min-w-[10rem] flex-col gap-1 sm:min-w-[12rem]">
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
        <span className="hidden font-mono text-[11px] text-ink-muted sm:inline">
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
