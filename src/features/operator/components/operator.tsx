"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DemoBar, demoBarControlClass } from "@/components/demo/demo-bar";
import {
  isOver,
  type RulebookVersion,
  type RunSummary,
  type TaskCard,
} from "../domain/contract";
import { REPLAY_TASK_IDS } from "../domain/replays";
import { api } from "./api";
import { operatorRunFor } from "./compare";
import { ConnectClient } from "./connect-client";
import { HandMode } from "./hand-mode";
import "./operator.css";
import { RulesEditor } from "./rules-editor";
import { detailOfView } from "./run-view";
import { RunsHistory } from "./runs-history";
import { StageSkeleton } from "./skeletons";
import { Stage } from "./stage";
import { TaskPicker } from "./task-picker";
import { Button, ErrorNote, friendly, Panel } from "./ui";
import { UnderTheHood } from "./under-the-hood";
import {
  HOME,
  hrefOf,
  type Place,
  placeOf,
  samePlace,
  TAB_IDS,
  TAB_LABEL,
  type Tab,
} from "./url";
import { type FinishedRuns, useRecorded, useRun } from "./use-run";

/**
 * Operator, the demo. One agent keys a green-screen system from pictures of
 * its Screen while Rules and a Guard decide what it may commit, and code
 * says afterwards whether the work was done. The Run place shows a recorded
 * Run until the visitor starts one, or takes the keyboard.
 */
export function Operator({
  tasks,
  initialRuns,
  initialRulebooks,
}: {
  /** The sample Tasks: seed data, rendered with the page. */
  tasks: TaskCard[];
  /** The Owner's Runs, read with the page; null if they could not be. */
  initialRuns: RunSummary[] | null;
  /** The Owner's Rulebook versions, read with the page; null if they could not be. */
  initialRulebooks: RulebookVersion[] | null;
}) {
  const [place, setPlace] = useState<Place>(HOME);
  const [visited, setVisited] = useState<Tab[]>(["run"]);
  /** The sample Task the visitor is keying by hand. Not in the address: it lives in this tab only. */
  const [hand, setHand] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(initialRuns);
  const [runsError, setRunsError] = useState<string | null>(
    initialRuns ? null : "Your Runs could not load.",
  );
  const [runsBusy, setRunsBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  // Finished Runs are kept for the visit, here and not in a module, so they go when the page does.
  const [finished] = useState<FinishedRuns>(() => new Map());
  const run = useRun(place.run, finished);
  const recordedId = place.run
    ? null
    : (place.replay ?? REPLAY_TASK_IDS[0] ?? null);
  const recorded = useRecorded(recordedId);
  // The comparison's fallback: the recorded Run of the first sample, whatever is open.
  const firstId = REPLAY_TASK_IDS[0] ?? null;
  const other = useRecorded(recordedId === firstId ? null : firstId);
  const shipped = recordedId === firstId ? recorded : other;

  // The address follows the place, so a reload or a shared link lands there.
  const go = useCallback((next: Place, scroll = false) => {
    setPlace((current) => {
      if (samePlace(current, next)) return current;
      const href = hrefOf(next, window.location.pathname);
      if (current.tab !== next.tab) window.history.pushState(null, "", href);
      else window.history.replaceState(null, "", href);
      return next;
    });
    setVisited((tabs) =>
      tabs.includes(next.tab) ? tabs : [...tabs, next.tab],
    );
    if (scroll)
      requestAnimationFrame(() =>
        stage.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
  }, []);

  // The page is static until hydrated, so the address is read after mount.
  useEffect(() => {
    const read = () => {
      const next = placeOf(window.location.search);
      setPlace(next);
      setVisited((tabs) =>
        tabs.includes(next.tab) ? tabs : [...tabs, next.tab],
      );
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  // One list refresh at a time: a newer one aborts the older, so a slow
  // answer never lands over a fresher one.
  const runsRequest = useRef<AbortController | null>(null);
  const refreshRuns = useCallback(async () => {
    runsRequest.current?.abort();
    const controller = new AbortController();
    runsRequest.current = controller;
    setRunsBusy(true);
    try {
      const next = await api.runs({ signal: controller.signal });
      setRuns(next);
      setRunsError(null);
    } catch (error) {
      if (!controller.signal.aborted)
        setRunsError(friendly(error, "Your Runs could not load."));
    } finally {
      if (runsRequest.current === controller) setRunsBusy(false);
    }
  }, []);
  useEffect(() => () => runsRequest.current?.abort(), []);

  const status = run.view.status;
  const over = run.detail !== null && isOver(status);
  // The list says what the stage says: refreshed when the open Run ends, pauses or carries on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `status` is the trigger
  useEffect(() => {
    if (place.run && run.detail) void refreshRuns();
  }, [place.run, over, status === "paused", refreshRuns]);

  const openDetail = useMemo(
    () => (run.detail ? detailOfView(run.detail, run.view) : null),
    [run.detail, run.view],
  );
  const inFlight = useMemo(() => {
    const going = (runs ?? []).find((item) => !isOver(item.status));
    if (!going) return null;
    // The stream knows the open Run ended before the list does.
    return going.id === place.run && over ? null : going;
  }, [runs, place.run, over]);

  const openRun = (runId: string) => {
    setHand(null);
    go({ tab: "run", run: runId, replay: null }, true);
  };
  const select = (tab: Tab) => go({ ...place, tab });

  const shippedRun = shipped.kind === "ready" ? shipped.detail : null;
  const operatorRun = operatorRunFor(
    openDetail?.taskId ?? null,
    runs ?? [],
    shippedRun,
  );
  const handTask = hand ? tasks.find((task) => task.id === hand) : undefined;
  const onStage =
    openDetail ?? (recorded.kind === "ready" ? recorded.detail : null);

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBar
        slug="operator"
        name="Operator"
        current={place.tab}
        panelsId="op"
        rowFrom="xl"
        tabs={TAB_IDS.map((id) => ({
          id,
          label: TAB_LABEL[id],
          onSelect: () => select(id),
        }))}
      >
        {inFlight ? (
          <button
            type="button"
            onClick={() => openRun(inFlight.id)}
            title={`Open the Run in progress: ${inFlight.title}`}
            className={demoBarControlClass}
          >
            <span className="size-2 shrink-0 bg-seal-red motion-safe:animate-pulse" />
            {inFlight.status === "paused" ? "Needs you" : "Live Run"}
          </button>
        ) : null}
      </DemoBar>

      <main className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
        <div
          id="op-panel-run"
          role="tabpanel"
          aria-labelledby="op-tab-run"
          hidden={place.tab !== "run"}
          className="flex flex-col gap-10"
        >
          <header className="flex max-w-3xl flex-col gap-2">
            <p className="eyebrow text-ink-muted">
              Data entry in a system with no API
            </p>
            <h1 className="font-mono text-2xl leading-tight font-bold uppercase sm:text-3xl">
              The Operator keys the green screen. Code decides what counts.
            </h1>
            <p className="text-ink-muted">
              HARBOURMASTER is a legacy terminal system with function keys and
              no API. One agent works it from pictures of the Screen, with the
              keyboard and the mouse. A Guard sees every key first and stops the
              ones the Rules reserve for a person. Afterwards code compares the
              Books with the Task. Synthetic data, Port Authority of Meridia.
            </p>
          </header>

          <TaskPicker
            tasks={tasks}
            inFlight={inFlight}
            handTaskId={hand}
            onOpenRun={(item) => openRun(item.id)}
            onStarted={(runId) => {
              openRun(runId);
              void refreshRuns();
            }}
            onHand={(taskId) => {
              setHand(taskId);
              go({ tab: "run", run: null, replay: null }, true);
            }}
          />

          <section
            ref={stage}
            aria-label="The stage"
            className="flex scroll-mt-20 flex-col gap-4"
          >
            <p className="font-mono text-lg font-bold uppercase">
              2. {handTask ? "Key it yourself" : "Watch it work"}
            </p>
            {handTask ? (
              <HandMode
                key={handTask.id}
                task={handTask}
                onExit={() => setHand(null)}
                onFinished={(runId) => {
                  openRun(runId);
                  void refreshRuns();
                }}
              />
            ) : place.run ? (
              run.missing ? (
                <Panel eyebrow="Run" title="Not found">
                  <p className="text-sm">
                    There is no such Run among yours. It may belong to another
                    Guest pass.
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() => go({ ...place, run: null })}
                  >
                    Back to the recorded Run
                  </Button>
                </Panel>
              ) : run.error ? (
                <Panel eyebrow="Run" title="Could not load">
                  <ErrorNote>{run.error}</ErrorNote>
                </Panel>
              ) : run.detail ? (
                <Stage
                  key={run.detail.id}
                  detail={run.detail}
                  view={run.view}
                  recorded={false}
                  operatorRun={operatorRun}
                />
              ) : (
                <StageSkeleton label="Loading the Run" />
              )
            ) : recorded.kind === "ready" ? (
              <Stage
                key={`recorded-${recordedId}`}
                detail={recorded.detail}
                view={recorded.view}
                recorded
                operatorRun={null}
              />
            ) : recorded.kind === "loading" ? (
              <StageSkeleton label="Loading the recorded Run" />
            ) : (
              <Panel eyebrow="Nothing on the stage yet" title="No recorded Run">
                <p className="text-sm text-ink-muted">
                  There is no recorded Run to watch here yet. Pick a Task above
                  and let the Operator do it, or take the keyboard yourself.
                </p>
              </Panel>
            )}
            {place.run && !handTask ? (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => go({ ...place, run: null })}
                >
                  Close this Run and show the recorded one
                </Button>
              </div>
            ) : null}
          </section>

          <RunsHistory
            runs={runs}
            error={runsError}
            busy={runsBusy}
            openId={place.run}
            onOpen={(item) => openRun(item.id)}
            onRefresh={() => void refreshRuns()}
          />
        </div>

        {visited.includes("rules") ? (
          <div
            id="op-panel-rules"
            role="tabpanel"
            aria-labelledby="op-tab-rules"
            hidden={place.tab !== "rules"}
          >
            <RulesEditor initialRulebooks={initialRulebooks} />
          </div>
        ) : null}
        {visited.includes("hood") ? (
          <div
            id="op-panel-hood"
            role="tabpanel"
            aria-labelledby="op-tab-hood"
            hidden={place.tab !== "hood"}
          >
            <UnderTheHood run={onStage} />
          </div>
        ) : null}
        {visited.includes("connect") ? (
          <div
            id="op-panel-connect"
            role="tabpanel"
            aria-labelledby="op-tab-connect"
            hidden={place.tab !== "connect"}
          >
            <ConnectClient />
          </div>
        ) : null}
      </main>
    </div>
  );
}
