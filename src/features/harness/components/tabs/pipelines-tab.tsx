"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PIPELINES, pipelineOf } from "../../domain/pipelines";
import {
  type ApprovalDecision,
  type ApprovalView,
  isRunActive,
  type RunSummary,
} from "../../domain/run";
import { api, keys, messageOf } from "../api";
import { useController, useHarness } from "../harness-context";
import { approvalGate, pendingApproval } from "../pipelines/approval-gating";
import { humanize } from "../pipelines/format";
import { PipelinePreview } from "../pipelines/pipeline-preview";
import { RunPane } from "../pipelines/run-pane";
import { RunStore } from "../pipelines/run-store";
import {
  PipelineCatalogue,
  type RunFilter,
  RunsList,
} from "../pipelines/runs-list";
import { StepDetail } from "../pipelines/step-detail";
import { Button, cx, Empty, Panel } from "../ui";

/** Every Run opened here, each kept live by its own stream, for as long as the page stays open. */
const runStore = new RunStore({
  get: (id) => api.runs.get(id),
  events: (id, from, signal) => api.runs.events(id, from, signal),
});

/** How long `waitForApproval` waits for a Run to reach its Approval. */
const APPROVAL_WAIT_MS = 180_000;

const titleOf = (run: Pick<RunSummary, "pipelineId">) =>
  pipelineOf(run.pipelineId)?.title ?? humanize(run.pipelineId);

/**
 * Pipelines: the catalogue of Pipelines, the Runs, and the live view of one
 * Run (graph, Step detail, Approval). A Run opened by link (`?run=`) or by
 * "View pipeline" in chat shows here.
 */
export default function PipelinesTab() {
  const { staff, runId, sessionId, openRun, openSession, openTab } =
    useHarness();
  const queryClient = useQueryClient();
  const watches = useSyncExternalStore(
    runStore.subscribe,
    runStore.getSnapshot,
    runStore.getSnapshot,
  );

  const [filter, setFilter] = useState<RunFilter>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStep, setPreviewStep] = useState<string | null>(null);
  const [decided, setDecided] = useState<{
    runId: string;
    message: string;
  } | null>(null);

  // The Run a controller call acts on, ahead of the address.
  const openRef = useRef<string | null>(runId);
  useEffect(() => {
    openRef.current = runId;
    if (runId) {
      runStore.open(runId);
      setPreviewId(null);
    }
  }, [runId]);

  // Queries -------------------------------------------------------------------
  const sessionFilter = filter === "session" && sessionId ? { sessionId } : {};
  const runs = useQuery({
    queryKey: keys.runs(sessionFilter),
    queryFn: () => api.runs.list(sessionFilter),
    refetchInterval: (query) =>
      query.state.data?.some((run) => isRunActive(run.status)) ? 3000 : 15_000,
  });
  const rules = useQuery({
    queryKey: keys.rules(),
    queryFn: () => api.rules.list(),
  });
  const ruleTitles = useMemo(
    () =>
      new Map(
        (rules.data ?? []).map((rule) => [rule.spec.id, rule.spec.title]),
      ),
    [rules.data],
  );

  // Runs at work are watched even when not open, so a status in the list is never stale.
  useEffect(() => {
    for (const run of runs.data ?? []) {
      if (isRunActive(run.status)) runStore.open(run.id);
    }
  }, [runs.data]);

  const statusOf = useCallback(
    (run: RunSummary) => watches.get(run.id)?.run?.status ?? run.status,
    [watches],
  );

  // Writes --------------------------------------------------------------------
  const refreshAfterWrite = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["harness", "runs"] });
    void queryClient.invalidateQueries({ queryKey: ["harness", "audit"] });
  }, [queryClient]);

  /** Gives or returns an Approval. Refuses first what the server would refuse. */
  const decide = useCallback(
    async (
      id: string,
      approval: ApprovalView,
      decision: ApprovalDecision,
      note: string,
    ) => {
      const run = runStore.get(id)?.run;
      if (!run) throw new Error("That Run is not open.");
      const gate = approvalGate(staff, run, approval);
      if (!gate.allowed)
        throw new Error(gate.reason ?? "You may not decide this Approval.");
      const trimmed = note.trim();
      const updated = await api.approvals.decide(approval.id, {
        decision,
        ...(trimmed ? { note: trimmed } : {}),
      });
      runStore.adopt(updated);
      refreshAfterWrite();
      setDecided({
        runId: id,
        message:
          decision === "approve"
            ? `Approved as ${staff.name}. The Run goes on.`
            : `Returned as ${staff.name}. The Run has ended.`,
      });
      return updated;
    },
    [staff, refreshAfterWrite],
  );

  const stop = useCallback(
    async (id: string) => {
      const updated = await api.runs.stop(id);
      runStore.adopt(updated);
      refreshAfterWrite();
      return updated;
    },
    [refreshAfterWrite],
  );

  // Demo mode's way in --------------------------------------------------------
  useController("pipelines", {
    async openRun(id) {
      openRef.current = id;
      openRun(id);
      runStore.open(id);
      const watch = await runStore.whenLoaded(id);
      if (watch?.state === "error" && !watch.run) {
        throw new Error(watch.error ?? "The Run did not load.");
      }
    },
    async approve(note) {
      const id = openRef.current;
      if (!id) throw new Error("No Run is open.");
      const run = runStore.get(id)?.run;
      const approval = run ? pendingApproval(run) : null;
      if (!approval)
        throw new Error("The open Run is not waiting for an Approval.");
      await decide(id, approval, "approve", note ?? "");
    },
    waitForApproval() {
      const id = openRef.current;
      if (!id) return Promise.reject(new Error("No Run is open."));
      runStore.open(id);
      return new Promise<ApprovalView>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe = () => {};
        const finish = (settle: () => void) => {
          clearTimeout(timer);
          unsubscribe();
          settle();
        };
        const check = () => {
          const watch = runStore.get(id);
          const approval = watch?.run ? pendingApproval(watch.run) : null;
          if (approval) return finish(() => resolve(approval));
          if (watch?.run && !isRunActive(watch.run.status)) {
            return finish(() =>
              reject(new Error("The Run ended without needing an Approval.")),
            );
          }
          if (watch?.state === "error" && !watch.run) {
            return finish(() =>
              reject(new Error(watch.error ?? "The Run did not load.")),
            );
          }
        };
        unsubscribe = runStore.subscribe(check);
        timer = setTimeout(
          () =>
            finish(() =>
              reject(
                new Error(
                  "The Run is not waiting for an Approval yet. Try again in a moment.",
                ),
              ),
            ),
          APPROVAL_WAIT_MS,
        );
        check();
      });
    },
  });

  // Views ---------------------------------------------------------------------
  const preview = previewId ? pipelineOf(previewId) : null;
  const showMain = runId !== null || preview !== null;
  const watch = runId ? watches.get(runId) : undefined;
  const runSpec = watch?.run ? pipelineOf(watch.run.pipelineId) : null;
  const openRule = (ruleId: string) => openTab("skills", { rule: ruleId });

  const closeMain = () => {
    setPreviewId(null);
    if (runId) openTab("pipelines", { run: null });
  };

  return (
    <div className="flex min-h-0 flex-1 bg-marble/40">
      <aside
        aria-label="Pipelines and Runs"
        className={cx(
          "min-h-0 w-full shrink-0 flex-col border-ink border-r-2 bg-paper md:flex md:w-80",
          showMain ? "hidden" : "flex",
        )}
      >
        <div className="hx-scroll min-h-0 flex-1 space-y-5 p-3">
          <section aria-labelledby="pipelines-heading">
            <h2
              id="pipelines-heading"
              className="mb-1.5 font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase"
            >
              Pipelines
            </h2>
            <PipelineCatalogue
              pipelines={PIPELINES}
              selectedId={previewId}
              onSelect={(id) => {
                setPreviewStep(null);
                setPreviewId(id);
                if (runId) openTab("pipelines", { run: null });
              }}
            />
          </section>

          <section aria-labelledby="runs-heading">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <h2
                id="runs-heading"
                className="min-w-0 flex-1 font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase"
              >
                Runs
              </h2>
              <fieldset className="flex rounded-sm outline-box text-xs">
                <legend className="sr-only">Which Runs to list</legend>
                <button
                  type="button"
                  aria-pressed={filter === "session"}
                  disabled={!sessionId}
                  title={
                    sessionId
                      ? undefined
                      : "Open a Session in Chat to list its Runs"
                  }
                  onClick={() => setFilter("session")}
                  className={cx(
                    "px-2 py-1 focus-visible:outline-2 focus-visible:outline-federal-blue disabled:opacity-50",
                    filter === "session"
                      ? "bg-ink text-paper"
                      : "hover:bg-marble",
                  )}
                >
                  This Session
                </button>
                <button
                  type="button"
                  aria-pressed={filter === "all"}
                  onClick={() => setFilter("all")}
                  className={cx(
                    "px-2 py-1 focus-visible:outline-2 focus-visible:outline-federal-blue",
                    filter === "all" ? "bg-ink text-paper" : "hover:bg-marble",
                  )}
                >
                  All
                </button>
              </fieldset>
            </div>
            <RunsList
              runs={runs.data}
              loading={runs.isPending}
              error={runs.isError ? messageOf(runs.error) : null}
              onRetry={() => void runs.refetch()}
              selectedId={runId}
              onSelect={(id) => {
                setPreviewId(null);
                openRun(id);
              }}
              titleOf={titleOf}
              statusOf={statusOf}
              emptyHint="Ask the Agent in Chat to run a Pipeline and it will appear here, live."
            />
          </section>
        </div>
      </aside>

      <section
        aria-label="Pipeline view"
        className={cx(
          "min-h-0 min-w-0 flex-1 flex-col",
          showMain ? "flex" : "hidden md:flex",
        )}
      >
        {showMain ? (
          <div className="hx-scroll min-h-0 flex-1 p-3 sm:p-5">
            <div className="mb-3 md:hidden">
              <Button size="sm" variant="secondary" onClick={closeMain}>
                Back to Runs
              </Button>
            </div>
            {runId ? (
              <RunPane
                key={runId}
                watch={watch}
                spec={runSpec}
                staff={staff}
                ruleTitles={ruleTitles}
                decided={decided?.runId === runId ? decided.message : null}
                decide={(approval, decision, note) =>
                  decide(runId, approval, decision, note)
                }
                stop={() => stop(runId)}
                retry={() => runStore.retry(runId)}
                onOpenSession={openSession}
                onOpenRule={openRule}
              />
            ) : preview ? (
              <div
                className={cx(
                  "grid gap-4",
                  previewStep && "2xl:grid-cols-[minmax(0,1fr)_23rem]",
                )}
              >
                <PipelinePreview
                  spec={preview}
                  selectedStepId={previewStep}
                  onSelectStep={setPreviewStep}
                  onOpenSkill={(skill) => openTab("skills", { skill })}
                  onAskAgent={() => openSession(null)}
                />
                {previewStep ? (
                  <Panel
                    title="Step detail"
                    className="min-w-0 self-start"
                    bodyClassName="p-3"
                  >
                    {(() => {
                      const step = preview.steps.find(
                        (item) => item.id === previewStep,
                      );
                      return step ? (
                        <StepDetail
                          spec={step}
                          view={null}
                          run={null}
                          ruleTitles={ruleTitles}
                          onOpenRule={openRule}
                          now={0}
                        />
                      ) : null;
                    })()}
                  </Panel>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <Empty title="Pick a Run to watch it" className="m-auto">
            Choose a Run on the left to see its Steps move, or a Pipeline to see
            its shape before any Run exists.
          </Empty>
        )}
      </section>
    </div>
  );
}
