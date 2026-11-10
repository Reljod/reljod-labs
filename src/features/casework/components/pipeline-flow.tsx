"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { JOBS, type JobId } from "../domain/jobs";
import type { ModelSettingsByPurpose, Purpose } from "../domain/model-config";
import { PIPELINE_IDS, PIPELINES, type PipelineId } from "../domain/pipelines";
import { SCENARIO_TONE } from "./cabinet";
import { JobGlyph, ScenarioGlyph } from "./glyphs";
import { ModelForm, modelSummary } from "./model-form";
import type { JobState, RunView } from "./run-reducer";

const PER_ROW = 4;
const NODE_WIDTH = 176;
const GAP_X = 64;
const ROW_HEIGHT = 136;

type StepData = {
  /** "chat" for the Specialist, otherwise the Job. */
  step: "chat" | JobId;
  title: string;
  /** The model it calls, or that it is rules only. */
  engine: string;
  purpose: Purpose | null;
  state: JobState | null;
  selected: boolean;
  [key: string]: unknown;
};

const STATE_TONE: Record<JobState, string> = {
  pending: "border-ink/40 bg-paper",
  running: "border-federal-blue bg-morning-haze cw-node-live",
  waiting: "border-oak bg-brass/30 cw-node-live",
  done: "border-ink bg-paper",
  skipped: "border-ink/30 bg-paper opacity-60",
  error: "border-seal-red bg-seal-red/10",
  stopped: "border-seal-red bg-seal-red/10",
};

const STATE_MARK: Partial<Record<JobState, string>> = {
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  error: "Failed",
  stopped: "Stopped",
};

const SIDES = [
  ["l", Position.Left],
  ["r", Position.Right],
  ["t", Position.Top],
  ["b", Position.Bottom],
] as const;

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const tone = data.state ? STATE_TONE[data.state] : "border-ink bg-paper";
  return (
    <div
      className={`rounded-sm border-2 px-2.5 py-2 text-left transition-[box-shadow,transform] duration-200 ${tone} ${data.selected ? "-translate-y-0.5 shadow-hard-md" : "shadow-hard-sm"}`}
      style={{ width: NODE_WIDTH }}
    >
      {SIDES.flatMap(([id, position]) => [
        <Handle
          key={`s${id}`}
          id={`s${id}`}
          type="source"
          position={position}
          isConnectable={false}
        />,
        <Handle
          key={`t${id}`}
          id={`t${id}`}
          type="target"
          position={position}
          isConnectable={false}
        />,
      ])}
      <div className="flex items-center gap-2">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-sm border-2 border-ink ${data.step === "chat" ? "bg-ink text-paper" : data.purpose ? "bg-federal-blue text-paper" : "bg-limestone"}`}
        >
          {data.step === "chat" ? (
            <span className="font-mono text-sm font-bold">❯</span>
          ) : (
            <JobGlyph job={data.step} size={16} />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] font-bold tracking-[0.06em] uppercase">
            {data.title}
          </p>
          <p className="truncate text-[10.5px] text-ink-muted">{data.engine}</p>
        </div>
      </div>
      {data.state && STATE_MARK[data.state] ? (
        <p className="mt-1.5 font-mono text-[9.5px] font-bold tracking-[0.08em] text-ink-muted uppercase">
          {STATE_MARK[data.state]}
        </p>
      ) : null}
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

const FIT = { padding: 0.2, maxZoom: 1.1 };

const TAB_LABEL: Record<PipelineId, string> = {
  pension_withdrawal: "Withdrawal",
  employer_onboarding: "Employer",
  structure_review: "Structure",
  screening_review: "Screening",
};

/** Rows of four that snake: left to right, then down, then right to left. */
function place(index: number) {
  const row = Math.floor(index / PER_ROW);
  const column = index % PER_ROW;
  const forward = row % 2 === 0;
  return {
    row,
    forward,
    x: (forward ? column : PER_ROW - 1 - column) * (NODE_WIDTH + GAP_X),
    y: row * ROW_HEIGHT,
  };
}

/**
 * A Pipeline drawn as a graph: the Specialist, then each Job in order. Click
 * a step to see what it does and, where it calls a model, to change that
 * model and its settings. While a Run of this Pipeline is going, the steps
 * show where it is.
 */
export function PipelineFlow({
  settings,
  onSettings,
  run,
}: {
  settings: ModelSettingsByPurpose;
  onSettings: (settings: ModelSettingsByPurpose) => void;
  run: RunView;
}) {
  const [pipeline, setPipeline] = useState<PipelineId>(
    run.pipeline ?? "pension_withdrawal",
  );
  const [selected, setSelected] = useState<"chat" | JobId>("chat");

  // Follow a Run onto its Pipeline when it is planned or inferred.
  useEffect(() => {
    if (run.pipeline) setPipeline(run.pipeline);
  }, [run.pipeline]);

  const live = run.pipeline === pipeline && run.jobs.length > 0;
  const steps = useMemo(
    () => ["chat" as const, ...PIPELINES[pipeline].jobs],
    [pipeline],
  );

  const nodes = useMemo(
    () =>
      steps.map((step, index): Node<StepData> => {
        const purpose: Purpose | null =
          step === "chat" ? "chat" : (JOBS[step].model ?? null);
        const state =
          live && step !== "chat"
            ? (run.jobs.find((item) => item.job === step)?.state ?? "pending")
            : null;
        const { x, y } = place(index);
        return {
          id: step,
          type: "step",
          position: { x, y },
          data: {
            step,
            title: step === "chat" ? "Specialist" : JOBS[step].title,
            engine: purpose
              ? modelSummary(settings[purpose])
              : "Rules, no model",
            purpose,
            state,
            selected: selected === step,
          },
        };
      }),
    [steps, settings, selected, live, run.jobs],
  );

  const edges = useMemo(
    () =>
      steps.slice(1).map((step, offset): Edge => {
        const from = place(offset);
        const to = place(offset + 1);
        const sameRow = from.row === to.row;
        const state = live
          ? run.jobs.find((item) => item.job === step)?.state
          : undefined;
        return {
          id: `${steps[offset]}-${step}`,
          source: steps[offset],
          target: step,
          sourceHandle: sameRow ? (from.forward ? "sr" : "sl") : "sb",
          targetHandle: sameRow ? (from.forward ? "tl" : "tr") : "tt",
          type: "smoothstep",
          animated: state === "running" || state === "waiting",
          style: {
            stroke:
              state && state !== "pending"
                ? "var(--color-federal-blue)"
                : "var(--color-ink)",
            strokeWidth: 2,
            opacity: live && (!state || state === "pending") ? 0.3 : 1,
          },
        };
      }),
    [steps, live, run.jobs],
  );

  const tone = SCENARIO_TONE[pipeline];
  const job = selected === "chat" ? null : JOBS[selected];
  const purpose: Purpose | null =
    selected === "chat" ? "chat" : (job?.model ?? null);
  const sharedWith =
    selected === "chat"
      ? []
      : PIPELINE_IDS.filter(
          (id) => id !== pipeline && PIPELINES[id].jobs.includes(selected),
        );

  return (
    <section
      aria-label="Pipelines"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border-2 border-ink bg-paper shadow-hard-md"
    >
      <div className="flex flex-wrap gap-0 border-ink border-b-2 bg-marble">
        {PIPELINE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={pipeline === id}
            onClick={() => {
              setPipeline(id);
              setSelected("chat");
            }}
            className={`flex items-center gap-2 border-ink/20 border-r px-3 py-2.5 font-mono text-[11px] font-bold tracking-[0.06em] uppercase transition-colors ${pipeline === id ? "bg-paper text-ink" : "text-ink-muted hover:bg-paper/60"}`}
          >
            <span className={SCENARIO_TONE[id].text}>
              <ScenarioGlyph scenario={id} size={15} />
            </span>
            {TAB_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[260px] min-w-0 flex-1">
          <div
            className={`absolute top-0 right-0 left-0 z-10 h-1 ${tone.bar}`}
          />
          <p className="absolute top-1 right-0 left-0 z-10 border-ink/15 border-b bg-paper/95 px-3 py-1.5 text-xs text-ink-muted">
            {PIPELINES[pipeline].blurb}.
            {live ? (
              <span className="ml-1 font-bold text-federal-blue">
                Showing the current run.
              </span>
            ) : null}
          </p>
          <ReactFlow
            key={pipeline}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={FIT}
            // The panel settles its size a moment after it mounts; fit again then.
            onInit={(flow) => {
              setTimeout(() => void flow.fitView(FIT), 80);
            }}
            minZoom={0.4}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            onNodeClick={(_, node) => setSelected(node.id as "chat" | JobId)}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={18}
              size={1}
              color="rgb(20 33 61 / 0.18)"
            />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        </div>

        <aside className="cw-scroll grid min-h-0 shrink-0 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto border-ink border-t-2 bg-marble/60 p-5 lg:w-[400px] lg:border-t-0 lg:border-l-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-sm border-2 border-ink ${selected === "chat" ? "bg-ink text-paper" : purpose ? "bg-federal-blue text-paper" : "bg-limestone"}`}
              >
                {selected === "chat" ? (
                  <span className="font-mono text-sm font-bold">❯</span>
                ) : (
                  <JobGlyph job={selected} size={18} />
                )}
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[10px] tracking-[0.1em] text-ink-muted uppercase">
                  {selected === "chat"
                    ? "Before the pipeline"
                    : `Step ${PIPELINES[pipeline].jobs.indexOf(selected) + 1} of ${PIPELINES[pipeline].jobs.length}`}
                </p>
                <h3 className="truncate font-mono text-base leading-tight font-bold uppercase">
                  {job ? job.title : "Specialist"}
                </h3>
              </div>
              <span
                className={`ml-auto shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.06em] uppercase ${purpose ? "border-federal-blue text-federal-blue" : "border-ink/40 text-ink-muted"}`}
              >
                {purpose ? "Model" : "Rules"}
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
              {job
                ? job.description
                : "The chat agent. It checks it has the documents and knows what is wanted, then calls a pipeline or a single job as a tool on the MCP server. It never decides a case."}
            </p>
            {(job && job.after.length > 0) || sharedWith.length > 0 ? (
              <dl className="mt-3 grid gap-1 text-xs">
                {job && job.after.length > 0 ? (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 font-mono text-[10px] tracking-[0.08em] text-ink-muted uppercase">
                      Reads
                    </dt>
                    <dd>{job.after.map((id) => JOBS[id].title).join(", ")}</dd>
                  </div>
                ) : null}
                {sharedWith.length > 0 ? (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 font-mono text-[10px] tracking-[0.08em] text-ink-muted uppercase">
                      Also in
                    </dt>
                    <dd>{sharedWith.map((id) => TAB_LABEL[id]).join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
          <div className="min-w-0">
            {purpose ? (
              <>
                <ModelForm
                  purpose={purpose}
                  settings={settings}
                  onSettings={onSettings}
                />
                <p className="mt-2 text-[11px] leading-snug text-ink-muted">
                  Applies from this desk's next call
                  {selected === "chat"
                    ? "."
                    : ", in every pipeline that has this job."}
                </p>
              </>
            ) : (
              <div className="rounded-sm border-2 border-ink/25 bg-paper p-3 text-xs leading-relaxed text-ink-muted">
                <p className="font-mono text-[11px] font-bold tracking-[0.06em] text-ink uppercase">
                  Nothing to configure
                </p>
                <p className="mt-1">
                  This step is rules: pure functions over what was read. The
                  same documents always give the same checks, and it costs
                  nothing to run.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
