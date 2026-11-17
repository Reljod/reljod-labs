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
import { useMemo } from "react";
import type { PipelineSpec, StepKind, StepSpec } from "../../domain/pipeline";
import type {
  RunStatus,
  RunView,
  StepStatus,
  StepView,
} from "../../domain/run";
import { cx, Spinner } from "../ui";
import { formatDuration, formatTokens } from "./format";
import {
  layoutPipeline,
  NODE_HEIGHT,
  NODE_WIDTH,
  type PipelineLayout,
} from "./layout";
import { STEP_STATUS_LABEL } from "./status";

/** What a node shows besides the Step's status: an Approval Step at work waits for a person. */
export type NodeState = StepStatus | "waiting" | null;

/** The state a Step's node takes, given its view and the Run it is in. Null with no Run (a Pipeline's shape). */
export function nodeState(
  step: Pick<StepSpec, "kind">,
  view: Pick<StepView, "status"> | null,
  runStatus: RunStatus | null,
): NodeState {
  if (!view) return null;
  if (
    step.kind === "approval" &&
    view.status === "running" &&
    runStatus === "waiting_approval"
  ) {
    return "waiting";
  }
  return view.status;
}

const STATE_CLASS: Record<Exclude<NodeState, null>, string> = {
  pending: "border-dashed border-ink/30 bg-paper text-ink-muted",
  running: "hx-node-live border-federal-blue bg-morning-haze",
  waiting: "hx-node-live border-oak bg-brass/20",
  done: "border-ivy/60 bg-paper",
  failed: "border-seal-red bg-seal-red/5",
  skipped: "border-ink/20 bg-marble text-ink-muted",
};

const STATE_LABEL: Record<Exclude<NodeState, null>, string> = {
  ...STEP_STATUS_LABEL,
  waiting: "Waiting for Approval",
};

export const KIND_LABEL: Record<StepKind, string> = {
  code: "Code",
  model: "Model",
  approval: "Approval",
};

/** A small glyph for what kind of Step it is: code, a model call or a person's Approval. */
export function KindIcon({
  kind,
  className = "",
}: {
  kind: StepKind;
  className?: string;
}) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("shrink-0", className)}
    >
      <title>{KIND_LABEL[kind]}</title>
      {kind === "code" ? (
        <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
      ) : kind === "model" ? (
        <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.6 3.6l2 2M10.4 10.4l2 2M12.4 3.6l-2 2M5.6 10.4l-2 2" />
      ) : (
        <>
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 14c.4-2.6 2.4-4 5-4s4.6 1.4 5 4M11.5 3.5l1 1 2-2" />
        </>
      )}
    </svg>
  );
}

function StateMark({ state }: { state: NodeState }) {
  switch (state) {
    case "running":
      return <Spinner className="text-federal-blue" />;
    case "waiting":
      return (
        <span aria-hidden="true" className="hx-pulse text-oak">
          ●
        </span>
      );
    case "done":
      return (
        <span aria-hidden="true" className="font-bold text-ivy">
          ✓
        </span>
      );
    case "failed":
      return (
        <span aria-hidden="true" className="font-bold text-seal-red">
          ✕
        </span>
      );
    case "skipped":
      return (
        <span aria-hidden="true" className="text-ink-muted">
          –
        </span>
      );
    case "pending":
      return (
        <span aria-hidden="true" className="text-ink-muted">
          ○
        </span>
      );
    default:
      return null;
  }
}

type StepNodeData = {
  step: StepSpec;
  view: StepView | null;
  state: NodeState;
  selected: boolean;
  now: number;
  onSelect: (stepId: string) => void;
  [key: string]: unknown;
};

function elapsedOf(view: StepView | null, now: number): number | null {
  if (!view?.startedAt) return null;
  const start = Date.parse(view.startedAt);
  const end = view.finishedAt ? Date.parse(view.finishedAt) : now;
  return Number.isNaN(start) || Number.isNaN(end)
    ? null
    : Math.max(0, end - start);
}

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { step, view, state, selected, now } = data;
  const elapsed = elapsedOf(view, now);
  const usage = view?.usage ?? null;
  const detail =
    usage && step.kind === "model"
      ? `${usage.model} · ${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out`
      : step.kind === "model"
        ? "Model call"
        : step.kind === "approval"
          ? step.risk === "high"
            ? "A person approves · high risk"
            : "A person approves"
          : "Code, no model";
  const label = `${step.title}. ${KIND_LABEL[step.kind]} Step${state ? `, ${STATE_LABEL[state]}` : ""}. Show details.`;
  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cx(
        "rounded-sm border transition-colors duration-200",
        state ? STATE_CLASS[state] : "border-ink/40 bg-paper",
        selected && "outline-2 outline-offset-2 outline-federal-blue",
      )}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        onClick={() => data.onSelect(step.id)}
        className="nodrag nopan flex h-full w-full flex-col justify-between rounded-sm px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
      >
        <span className="flex items-center gap-1.5">
          <KindIcon kind={step.kind} className="text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold">
            {step.title}
          </span>
          <StateMark state={state} />
        </span>
        <span className="flex items-center justify-between gap-2 text-[0.68rem] text-ink-muted">
          <span className="truncate">
            {state ? STATE_LABEL[state] : KIND_LABEL[step.kind]}
          </span>
          {elapsed !== null ? (
            <span className="shrink-0 font-mono">
              {formatDuration(elapsed)}
            </span>
          ) : null}
        </span>
        <span className="truncate font-mono text-[0.64rem] text-ink-muted">
          {detail}
        </span>
      </button>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

/** See `onNodeClick` below: present so nodes take pointer events. */
const keepNodesClickable = () => {};

const NODE_TYPES = { step: StepNode };
const FIT = { padding: 0.12, maxZoom: 1.1 };

/**
 * A Pipeline drawn as a graph, one row per level, so Steps that run at the
 * same time stand side by side. With a Run each node shows where the Step
 * is: pending, running (it moves), done, failed, skipped or waiting for an
 * Approval. Without one it is the Pipeline's shape.
 */
export function PipelineGraph({
  spec,
  run,
  selectedStepId,
  onSelect,
  now,
  label,
}: {
  spec: Pick<PipelineSpec, "steps">;
  run: RunView | null;
  selectedStepId: string | null;
  onSelect: (stepId: string) => void;
  now: number;
  label: string;
}) {
  const layout: PipelineLayout = useMemo(() => layoutPipeline(spec), [spec]);

  const { nodes, edges } = useMemo(() => {
    const viewOf = (id: string) =>
      run?.steps.find((step) => step.stepId === id) ?? null;
    const nodes: Node<StepNodeData>[] = layout.nodes.map((placed) => {
      const view = viewOf(placed.step.id);
      return {
        id: placed.step.id,
        type: "step",
        position: { x: placed.x, y: placed.y },
        draggable: false,
        focusable: false,
        data: {
          step: placed.step,
          view,
          state: nodeState(placed.step, view, run?.status ?? null),
          selected: selectedStepId === placed.step.id,
          now,
          onSelect,
        },
      };
    });
    const edges: Edge[] = layout.edges.map((edge) => {
      const from = viewOf(edge.source);
      const to = viewOf(edge.target);
      const reached = to && to.status !== "pending";
      const flowing = to?.status === "running" && from?.status !== "running";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        animated: flowing,
        style: {
          stroke: reached ? "var(--color-federal-blue)" : "var(--color-ink)",
          strokeWidth: 1.5,
          opacity: run && !reached ? 0.28 : 0.7,
        },
      };
    });
    return { nodes, edges };
  }, [layout, run, selectedStepId, now, onSelect]);

  if (layout.problem) {
    return (
      <p role="alert" className="p-4 text-sm text-seal-red">
        This Pipeline's Steps cannot be drawn. {layout.problem}
      </p>
    );
  }
  if (layout.nodes.length === 0) {
    return (
      <p className="p-4 text-sm text-ink-muted">This Pipeline has no Steps.</p>
    );
  }

  const height = Math.min(Math.max(layout.height + 72, 240), 560);
  return (
    <section
      aria-label={label}
      style={{ height }}
      className="hx-flow relative w-full min-w-0"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={FIT}
        // The pane settles its size a moment after it mounts; fit again then.
        onInit={(flow) => {
          setTimeout(() => void flow.fitView(FIT), 80);
        }}
        minZoom={0.3}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        // React Flow gives a node `pointer-events: none` when it is neither
        // selectable, draggable nor has a click handler, and the pane then
        // swallows every click on the node's own button. The button does the
        // work; this handler only keeps the node clickable.
        onNodeClick={keepNodesClickable}
        zoomOnScroll={false}
        preventScrolling={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          color="rgb(20 33 61 / 0.14)"
        />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </section>
  );
}
