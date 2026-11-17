"use client";

import { useMemo, useState } from "react";
import type { PipelineSpec } from "../../domain/pipeline";
import type { ApprovalDecision, ApprovalView } from "../../domain/run";
import { isRunActive } from "../../domain/run";
import type { Staff } from "../../domain/staff";
import { Button, DoneNote, Empty, ErrorNote, Loading, Panel } from "../ui";
import { pendingApproval } from "./approval-gating";
import { ApprovalPanel } from "./approval-panel";
import { PipelineGraph } from "./flow";
import { specForRun } from "./layout";
import { RunHeader } from "./run-header";
import type { RunWatch } from "./run-store";
import { OutputView, StepDetail } from "./step-detail";
import { useNow } from "./use-now";

/**
 * One Run, live: the header, the Approval it waits on, the graph of Steps and
 * the detail of the Step picked. Everything comes from the watch the store
 * keeps, so switching to another Run and back loses nothing.
 */
export function RunPane({
  watch,
  spec,
  staff,
  ruleTitles,
  decided,
  decide,
  stop,
  retry,
  onOpenSession,
  onOpenRule,
}: {
  watch: RunWatch | undefined;
  spec: PipelineSpec | null;
  staff: Pick<Staff, "id" | "role" | "name">;
  ruleTitles: ReadonlyMap<string, string>;
  /** What the last Approval here said back, to show where it was clicked. */
  decided: string | null;
  decide: (
    approval: ApprovalView,
    decision: ApprovalDecision,
    note: string,
  ) => Promise<unknown>;
  stop: () => Promise<unknown>;
  retry: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenRule: (ruleId: string) => void;
}) {
  const run = watch?.run ?? null;
  const active = run ? isRunActive(run.status) : false;
  const now = useNow(active);
  const [picked, setPicked] = useState<string | null>(null);
  const drawn = useMemo(
    () => (run ? specForRun(spec, run) : { steps: [] }),
    [spec, run],
  );

  if (!watch || (watch.state === "loading" && !run)) {
    return <Loading rows={4} />;
  }
  if (!run) {
    return (
      <Empty
        title={
          watch.gone ? "This Run is not available" : "The Run did not load"
        }
        action={
          watch.gone ? null : (
            <Button variant="secondary" onClick={retry}>
              Try again
            </Button>
          )
        }
      >
        {watch.error ??
          "It may belong to another Workspace, or have been removed."}
      </Empty>
    );
  }

  const approval = pendingApproval(run);
  // With nothing picked, show the Step that needs attention: a failure, or the Approval.
  const attention =
    run.steps.find((step) => step.status === "failed")?.stepId ??
    (approval ? approval.stepId : null);
  const selectedId = picked ?? attention;
  const stepSpec = drawn.steps.find((step) => step.id === selectedId) ?? null;
  const stepView = run.steps.find((step) => step.stepId === selectedId) ?? null;
  const hasResult = run.result && Object.keys(run.result).length > 0;

  return (
    <div className="space-y-4">
      <RunHeader
        run={run}
        spec={spec}
        now={now}
        ruleTitles={ruleTitles}
        onStop={stop}
        onOpenSession={onOpenSession}
        onOpenRule={onOpenRule}
      />

      {watch.state === "reconnecting" ? (
        <output
          aria-live="polite"
          className="block rounded-sm border border-brass/60 bg-brass/10 px-3 py-2 text-xs text-oak"
        >
          The live view lost its connection. Reconnecting; nothing is lost.
        </output>
      ) : null}
      {watch.state === "error" ? (
        <ErrorNote onRetry={retry}>
          {watch.error ?? "The live view stopped."} What is shown is as of the
          last update.
        </ErrorNote>
      ) : null}
      {decided ? <DoneNote>{decided}</DoneNote> : null}

      {approval ? (
        <ApprovalPanel
          run={run}
          approval={approval}
          staff={staff}
          decide={decide}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel title="Steps" bodyClassName="p-0" className="min-w-0 self-start">
          <PipelineGraph
            spec={drawn}
            run={run}
            selectedStepId={selectedId}
            onSelect={setPicked}
            now={now}
            label="Steps of this Run, with where each one is"
          />
        </Panel>
        <Panel
          title="Step detail"
          className="min-w-0 self-start"
          bodyClassName="p-3"
        >
          {stepSpec ? (
            <StepDetail
              spec={stepSpec}
              view={stepView}
              run={run}
              ruleTitles={ruleTitles}
              onOpenRule={onOpenRule}
              now={now}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Pick a Step in the graph to see its output and its Findings.
            </p>
          )}
        </Panel>
      </div>

      {run.error ? <ErrorNote>{run.error}</ErrorNote> : null}
      {hasResult ? (
        <Panel title="Result" bodyClassName="p-3">
          <OutputView value={run.result} />
        </Panel>
      ) : null}
    </div>
  );
}
