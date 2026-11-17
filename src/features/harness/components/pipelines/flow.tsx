"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type Edge,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PipelineSpec, StepKind, StepSpec } from "../../domain/pipeline";
import type {
  RunStatus,
  RunView,
  StepStatus,
  StepView,
} from "../../domain/run";
import { Button, cx, Spinner } from "../ui";
import { formatDuration, formatTokens } from "./format";
import {
  fitGraph,
  GRAPH_PAD,
  type LevelBand,
  layoutPipeline,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_HEIGHT,
  type PipelineLayout,
  type PlacedStep,
} from "./layout";
import { PLAY_LEVEL_MS, type Rail, railOf, simulate } from "./progress";
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
        <motion.span
          aria-hidden="true"
          className="inline-block font-bold text-ivy"
          initial={{ scale: 0.2, rotate: -25 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 16 }}
        >
          ✓
        </motion.span>
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
  /** How long the Step has run (or ran), when known. */
  elapsed: number | null;
  level: number;
  /** The card's width in graph units (see `fitGraph`). */
  width: number;
  selected: boolean;
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

const SUCCESS_RING = [
  "0 0 0 0 rgb(47 107 63 / 0.55)",
  "0 0 0 12px rgb(47 107 63 / 0)",
];

/**
 * A Step's card. It slides in by level the first time it is drawn; a running
 * Step shimmers and counts; a Step that finishes ticks with one pulse; a
 * failed one shakes once; an Approval that waits glows.
 */
function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { step, view, state, elapsed, level, width, selected } = data;
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
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: Math.min(level * 0.07, 0.8),
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1],
      }}
      style={{ width, height: NODE_HEIGHT }}
    >
      <motion.div
        initial={false}
        animate={state ?? "idle"}
        variants={{
          done: {
            scale: [1, 1.06, 1],
            boxShadow: SUCCESS_RING,
            transition: { duration: 0.6, ease: "easeOut" },
          },
          failed: {
            x: [0, -8, 8, -6, 6, -3, 0],
            transition: { duration: 0.45 },
          },
        }}
        className={cx(
          "relative h-full w-full overflow-hidden rounded-md border-[1.5px] bg-paper transition-colors duration-300",
          state ? STATE_CLASS[state] : "border-ink/40 bg-paper",
          state === "waiting" && "hx-node-glow",
          selected && "outline-2 outline-offset-2 outline-federal-blue",
        )}
      >
        <Handle type="target" position={Position.Top} isConnectable={false} />
        <button
          type="button"
          aria-label={label}
          aria-pressed={selected}
          onClick={() => data.onSelect(step.id)}
          className="nodrag nopan flex h-full w-full flex-col justify-between px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-federal-blue"
        >
          <span className="flex items-center gap-2">
            <KindIcon kind={step.kind} className="text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-base leading-tight font-semibold">
              {step.title}
            </span>
            <StateMark state={state} />
          </span>
          <span className="flex items-center justify-between gap-2 text-sm text-ink-muted">
            <span className="truncate">
              {state ? STATE_LABEL[state] : KIND_LABEL[step.kind]}
            </span>
            {elapsed !== null ? (
              <span className="shrink-0 font-mono tabular-nums">
                {formatDuration(elapsed)}
              </span>
            ) : null}
          </span>
          <span className="truncate font-mono text-[0.8rem] text-ink-muted">
            {detail}
          </span>
        </button>
        {state === "running" ? <span className="hx-node-shimmer" /> : null}
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={false}
        />
      </motion.div>
    </motion.div>
  );
}

/** The soft band behind Steps that run together, with how many. */
function BandNode({
  data,
}: NodeProps<Node<{ count: number; level: number; [key: string]: unknown }>>) {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0.96 }}
      animate={{ opacity: 1, scaleX: 1 }}
      transition={{ delay: Math.min(data.level * 0.07, 0.8), duration: 0.5 }}
      className="hx-band h-full w-full rounded-xl border border-dashed border-federal-blue/35 bg-federal-blue/[0.06]"
    >
      <span className="hx-band-label">{data.count} at once</span>
    </motion.div>
  );
}

type EdgePhase = "idle" | "pending" | "flowing" | "done" | "failed";

/**
 * A dependency as a line: faint until its Step is reached, a dashed flow
 * toward a Step at work (with a dot riding it), and a solid settled line
 * once the Step has finished.
 */
function FlowEdge(props: EdgeProps<Edge<{ phase: EdgePhase }>>) {
  const phase = props.data?.phase ?? "idle";
  const reduced = useReducedMotion();
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 10,
  });
  const stroke =
    phase === "failed"
      ? "var(--color-seal-red)"
      : phase === "flowing"
        ? "var(--color-federal-blue)"
        : phase === "done"
          ? "var(--color-ivy)"
          : "var(--color-ink)";
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={{
          stroke,
          strokeWidth: phase === "idle" ? 1.6 : 2,
          opacity: phase === "pending" ? 0.22 : phase === "idle" ? 0.55 : 0.85,
          transition: "stroke 0.4s, opacity 0.4s",
        }}
      />
      {phase === "flowing" && !reduced ? (
        <>
          <path
            d={path}
            fill="none"
            className="hx-edge-flow"
            stroke="var(--color-federal-blue)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle r={4} fill="var(--color-federal-blue)">
            <animateMotion dur="1.3s" repeatCount="indefinite" path={path} />
          </circle>
        </>
      ) : null}
    </>
  );
}

/** See `onNodeClick` below: present so nodes take pointer events. */
const keepNodesClickable = () => {};

const NODE_TYPES = { step: StepNode, band: BandNode };
const EDGE_TYPES = { flow: FlowEdge };

const PHONE_QUERY = "(max-width: 639px)";
const subscribePhone = (notify: () => void) => {
  const list = window.matchMedia(PHONE_QUERY);
  list.addEventListener("change", notify);
  return () => list.removeEventListener("change", notify);
};
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;
const notPhone = () => false;

type GraphProps = {
  spec: Pick<PipelineSpec, "steps">;
  run: RunView | null;
  selectedStepId: string | null;
  onSelect: (stepId: string) => void;
  now: number;
  label: string;
};

/**
 * A Pipeline's Steps, where each one is. From 640 px wide it is a graph, and
 * on a phone a list of levels with Steps as rows (the nodes would be too
 * small to read or tap).
 */
export function PipelineGraph(props: GraphProps) {
  const phone = useSyncExternalStore(subscribePhone, isPhone, notPhone);
  return phone ? <PipelineLevels {...props} /> : <PipelineFlow {...props} />;
}

/**
 * The phone layout: one block per level, in the order they run, and a row per
 * Step. Steps of a level run at the same time, and the block says so.
 */
function PipelineLevels({
  spec,
  run,
  selectedStepId,
  onSelect,
  now,
  label,
}: GraphProps) {
  const layout: PipelineLayout = useMemo(() => layoutPipeline(spec), [spec]);
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
  const levels: PlacedStep[][] = [];
  for (const placed of layout.nodes) {
    const row = levels[placed.level] ?? [];
    row.push(placed);
    levels[placed.level] = row;
  }
  return (
    <section aria-label={label} className="space-y-3 p-3">
      {levels.map((row, level) => (
        <div key={row[0]?.step.id ?? level} className="space-y-1.5">
          <p className="font-mono text-[0.65rem] font-bold tracking-[0.08em] text-ink-muted uppercase">
            {level + 1}.{" "}
            {row.length > 1 ? `${row.length} Steps at the same time` : "Step"}
          </p>
          <ul className="space-y-1.5">
            {row.map(({ step }) => {
              const view =
                run?.steps.find((item) => item.stepId === step.id) ?? null;
              const state = nodeState(step, view, run?.status ?? null);
              const elapsed = elapsedOf(view, now);
              const selected = selectedStepId === step.id;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${step.title}. ${KIND_LABEL[step.kind]} Step${state ? `, ${STATE_LABEL[state]}` : ""}. Show details.`}
                    onClick={() => onSelect(step.id)}
                    className={cx(
                      "flex min-h-11 w-full items-center gap-2 rounded-sm border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
                      state ? STATE_CLASS[state] : "border-ink/40 bg-paper",
                      selected &&
                        "outline-2 outline-offset-2 outline-federal-blue",
                    )}
                  >
                    <KindIcon kind={step.kind} className="text-ink-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {step.title}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {state ? STATE_LABEL[state] : KIND_LABEL[step.kind]}
                        {step.kind === "approval"
                          ? step.risk === "high"
                            ? " · high risk"
                            : ""
                          : ""}
                      </span>
                    </span>
                    {elapsed !== null ? (
                      <span className="shrink-0 font-mono text-xs text-ink-muted">
                        {formatDuration(elapsed)}
                      </span>
                    ) : null}
                    <StateMark state={state} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** The width of an element, kept up to date. */
function useWidth() {
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const set = useCallback((element: HTMLElement | null) => {
    ref.current = element;
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [set, width] as const;
}

/**
 * The progress rail above the graph: the level a Run is at, a segment per
 * level (filled as it is done) and, for a preview, the Play button that makes
 * up a Run so the shape can be seen to move.
 */
function LevelRail({
  rail,
  mode,
  playing,
  onPlay,
  onStop,
}: {
  rail: Rail;
  mode: "preview" | "run" | "play";
  playing: boolean;
  onPlay?: () => void;
  onStop?: () => void;
}) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-ink/10 border-b bg-paper/95 px-4 py-2.5 backdrop-blur">
      <div className="min-w-0 flex-1 basis-60">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold" aria-live="polite">
            {rail.label}
          </span>
          <span className="text-xs text-ink-muted">{rail.detail}</span>
          {mode === "play" ? (
            <span className="rounded-sm bg-brass/25 px-1.5 text-[0.65rem] font-semibold tracking-wider text-oak uppercase">
              Simulation, no Run
            </span>
          ) : null}
        </p>
        <div
          className="mt-1.5 flex gap-1"
          role="img"
          aria-label={`${rail.total} levels`}
        >
          {rail.segments.map((segment, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a level is its place
              key={index}
              className="relative h-1.5 min-w-2 flex-1 overflow-hidden rounded-full bg-ink/12"
            >
              <motion.span
                className={cx(
                  "absolute inset-y-0 left-0 rounded-full",
                  segment === "failed" ? "bg-seal-red" : "bg-federal-blue",
                  segment === "active" && "hx-pulse",
                )}
                initial={false}
                animate={{
                  width:
                    segment === "done" || segment === "failed"
                      ? "100%"
                      : segment === "active"
                        ? "55%"
                        : segment === "idle"
                          ? "0%"
                          : "0%",
                }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
            </span>
          ))}
        </div>
      </div>
      {onPlay ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={playing ? onStop : onPlay}
          aria-pressed={playing}
          title="Makes up a Run so you can watch the Steps go through their levels. Nothing is called and nothing is spent."
        >
          {playing ? "Stop" : mode === "play" ? "Replay" : "Play"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A Pipeline drawn as a graph, one row per level, so Steps that run at the
 * same time stand side by side inside a band that counts them. It is fitted
 * to the width of its panel (and grows as tall as it needs, so the text stays
 * readable). With a Run each node shows where the Step is and the lines flow
 * toward the Step at work; a progress rail above says which level it is at.
 * Without a Run it is the Pipeline's shape, and Play makes up a Run.
 */
function PipelineFlow({
  spec,
  run,
  selectedStepId,
  onSelect,
  now,
  label,
}: GraphProps) {
  const [setBox, width] = useWidth();
  // Fit to the width: shrink to a readable zoom, or widen the cards, so the
  // graph spans the panel; pan sideways only when even that does not fit.
  const parallelism = useMemo(() => layoutPipeline(spec).parallelism, [spec]);
  const fit = useMemo(() => fitGraph(width, parallelism), [width, parallelism]);
  const layout: PipelineLayout = useMemo(
    () => layoutPipeline(spec, fit.nodeWidth),
    [spec, fit.nodeWidth],
  );

  // Play: a made-up Run, only without a real one.
  const [playStart, setPlayStart] = useState<number | null>(null);
  const [playTime, setPlayTime] = useState(0);
  useEffect(() => {
    if (playStart === null) return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - playStart;
      setPlayTime(elapsed);
      if (elapsed > (layout.levels + 1) * PLAY_LEVEL_MS) {
        clearInterval(timer);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [playStart, layout.levels]);
  const simulation = useMemo(
    () => (playStart !== null && !run ? simulate(layout, playTime) : null),
    [layout, playStart, playTime, run],
  );
  const playing = simulation !== null && !simulation.finished;
  const mode: "preview" | "run" | "play" = run
    ? "run"
    : simulation
      ? "play"
      : "preview";

  const viewOf = useCallback(
    (id: string) => run?.steps.find((step) => step.stepId === id) ?? null,
    [run],
  );
  const stateOf = useCallback(
    (step: StepSpec): NodeState => {
      if (simulation) return simulation.states.get(step.id) ?? "pending";
      return nodeState(step, viewOf(step.id), run?.status ?? null);
    },
    [simulation, viewOf, run],
  );

  const { nodes, edges, rail } = useMemo(() => {
    const states = new Map<string, NodeState>(
      layout.nodes.map((placed) => [placed.step.id, stateOf(placed.step)]),
    );
    const stateById = (id: string) => states.get(id) ?? null;
    const bandNodes: Node[] = layout.bands.map((band: LevelBand) => ({
      id: `band-${band.level}`,
      type: "band",
      position: { x: band.x, y: band.y },
      style: { width: band.width, height: band.height, pointerEvents: "none" },
      zIndex: -1,
      selectable: false,
      draggable: false,
      focusable: false,
      data: { count: band.count, level: band.level },
    }));
    const stepNodes: Node<StepNodeData>[] = layout.nodes.map(
      (placed: PlacedStep) => {
        const view = viewOf(placed.step.id);
        const state = stateById(placed.step.id);
        return {
          id: placed.step.id,
          type: "step",
          position: { x: placed.x, y: placed.y },
          draggable: false,
          focusable: false,
          data: {
            step: placed.step,
            view,
            state,
            elapsed: simulation
              ? (simulation.elapsed.get(placed.step.id) ?? null)
              : elapsedOf(view, now),
            level: placed.level,
            width: fit.nodeWidth,
            selected: selectedStepId === placed.step.id,
            onSelect,
          },
        };
      },
    );
    const edges: Edge[] = layout.edges.map((edge) => {
      const from = stateById(edge.source);
      const to = stateById(edge.target);
      let phase: EdgePhase = "idle";
      if (to !== null || from !== null) {
        if (to === "failed") phase = "failed";
        else if (to === "done" || to === "skipped") phase = "done";
        else if (
          (to === "running" || to === "waiting") &&
          (from === "done" || from === "skipped")
        )
          phase = "flowing";
        else phase = "pending";
      }
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "flow",
        data: { phase },
      };
    });
    const live = run !== null || simulation !== null;
    return {
      nodes: [...bandNodes, ...stepNodes],
      edges,
      rail: railOf(
        layout,
        live
          ? new Map([...states].map(([id, state]) => [id, state ?? "pending"]))
          : null,
        run?.status ?? null,
      ),
    };
  }, [
    layout,
    fit.nodeWidth,
    stateOf,
    viewOf,
    run,
    simulation,
    now,
    selectedStepId,
    onSelect,
  ]);

  const { zoom, pan: canPan } = fit;
  const height = Math.max(
    280,
    Math.ceil((layout.height + 2 * GRAPH_PAD) * zoom),
  );
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const home = useMemo(
    () => ({
      zoom,
      x: canPan ? GRAPH_PAD * zoom : (width - layout.width * zoom) / 2,
      y: GRAPH_PAD * zoom,
    }),
    [zoom, canPan, width, layout.width],
  );
  useEffect(() => setViewport(home), [home]);

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

  return (
    <MotionConfig reducedMotion="user">
      <LevelRail
        rail={rail}
        mode={mode}
        playing={playing}
        onPlay={
          run
            ? undefined
            : () => {
                setPlayTime(0);
                setPlayStart(Date.now());
              }
        }
        onStop={() => setPlayStart(null)}
      />
      <section
        aria-label={label}
        ref={setBox}
        style={{ height }}
        className="hx-flow relative w-full min-w-0"
      >
        {width > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            viewport={viewport}
            onViewportChange={setViewport}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={canPan}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            // React Flow gives a node `pointer-events: none` when it is neither
            // selectable, draggable nor has a click handler, and the pane then
            // swallows every click on the node's own button. The button does the
            // work; this handler only keeps the node clickable.
            onNodeClick={keepNodesClickable}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="rgb(20 33 61 / 0.13)"
            />
          </ReactFlow>
        ) : null}
      </section>
    </MotionConfig>
  );
}
