"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Departure } from "../domain/build-state";
import {
  BRANCHES,
  branchOf,
  categoryLabel,
  TONE_HEX,
  toneOf,
} from "../domain/categories";
import {
  type DraftEdge,
  type DraftGraph,
  type DraftNode,
  edgeKey,
  ROOT_KEY,
} from "../domain/graph";
import {
  type Box,
  branchBox,
  fitAspect,
  layoutGraph,
  leafBox,
  overviewBox,
  type Point,
  pointBox,
} from "../domain/layout";
import type { Highlight } from "../domain/traversal";
import "./client-manager.css";

export type CameraTarget =
  | { kind: "overview" }
  | { kind: "branch"; id: string }
  | { kind: "leaf"; id: string }
  | { kind: "node"; key: string }
  | { kind: "keys"; keys: string[] };

export function targetId(target: CameraTarget) {
  switch (target.kind) {
    case "overview":
      return "overview";
    case "branch":
    case "leaf":
      return `${target.kind}:${target.id}`;
    case "node":
      return `node:${target.key}`;
    case "keys":
      return `keys:${[...target.keys].sort().join(",")}`;
  }
}

type Props = {
  graph: DraftGraph;
  clientName: string;
  portraitUrl: string | null;
  highlight: Highlight;
  target: CameraTarget;
  selected: string | null;
  building: boolean;
  arrivals?: Record<string, number>;
  departures?: Departure[];
  recent?: { keys: string[]; text: string; tone: string; at: number }[];
  onTarget: (target: CameraTarget) => void;
  onSelect: (key: string | null) => void;
  hovered?: string | null;
};

const OVERVIEW = overviewBox();
const MIN_WIDTH = 160;
const MAX_WIDTH = OVERVIEW.width * 1.5;

const NODE_RADIUS: Partial<Record<DraftNode["type"], number>> = {
  person: 12,
  organization: 11,
  account: 10,
  asset: 10,
  goal: 10,
};

function initials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** A gentle curve that bows toward the client, so cross-links read as arcs. */
function curve(from: Point, to: Point) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const pull = Math.min(0.35, 60 / Math.max(distance, 1) + 0.12);
  const cx = mx * (1 - pull);
  const cy = my * (1 - pull);
  return `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
}

function lerpBox(a: Box, b: Box, t: number): Box {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

const viewBoxOf = (box: Box) =>
  `${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.width.toFixed(2)} ${box.height.toFixed(2)}`;

export function GraphCanvas({
  graph,
  clientName,
  portraitUrl,
  highlight,
  target,
  selected,
  building,
  arrivals,
  departures = [],
  recent = [],
  onTarget,
  onSelect,
  hovered = null,
}: Props) {
  const reduce = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const mini = useRef<SVGRectElement>(null);
  const camera = useRef<Box>(OVERVIEW);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [unit, setUnit] = useState(OVERVIEW.width / 800);
  const stop = useRef<(() => void) | null>(null);

  const layout = useMemo(() => layoutGraph(graph.nodes), [graph.nodes]);
  const nodeByKey = useMemo(
    () => new Map(graph.nodes.map((node) => [node.key, node])),
    [graph.nodes],
  );

  // What is in focus decides what is drawn loud and what fades back.
  const focusBranch =
    target.kind === "branch"
      ? target.id
      : target.kind === "leaf"
        ? target.id.split(".")[0]
        : null;
  const focusLeaf = target.kind === "leaf" ? target.id : null;
  const neighbours = useMemo(() => {
    if (!selected) return null;
    const keys = new Set([selected]);
    for (const edge of graph.edges) {
      if (edge.from === selected) keys.add(edge.to);
      if (edge.to === selected) keys.add(edge.from);
    }
    return keys;
  }, [graph.edges, selected]);
  const lit = highlight.nodes.size > 0;

  // Camera ---------------------------------------------------------------------

  const paint = useCallback((box: Box) => {
    camera.current = box;
    svg.current?.setAttribute("viewBox", viewBoxOf(box));
    if (mini.current) {
      mini.current.setAttribute("x", box.x.toFixed(1));
      mini.current.setAttribute("y", box.y.toFixed(1));
      mini.current.setAttribute("width", box.width.toFixed(1));
      mini.current.setAttribute("height", box.height.toFixed(1));
    }
  }, []);

  const settle = useCallback(() => {
    const width = wrap.current?.clientWidth || 800;
    setUnit(camera.current.width / width);
  }, []);

  const flyTo = useCallback(
    (box: Box, instant = false) => {
      const width = wrap.current?.clientWidth || 800;
      const height = wrap.current?.clientHeight || 600;
      const goal = fitAspect(box, width / height);
      stop.current?.();
      if (instant || reduce) {
        paint(goal);
        settle();
        return;
      }
      const from = camera.current;
      const controls = animate(0, 1, {
        duration: 0.9,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (t) => paint(lerpBox(from, goal, t)),
        onComplete: settle,
      });
      stop.current = () => controls.stop();
    },
    [paint, reduce, settle],
  );

  const boxFor = useCallback(
    (goal: CameraTarget): Box => {
      switch (goal.kind) {
        case "overview":
          return OVERVIEW;
        case "branch":
          return branchBox(layout, goal.id);
        case "leaf":
          return leafBox(layout, goal.id);
        case "node": {
          const points: Point[] = [];
          const center = layout.nodes.get(goal.key);
          if (center) points.push(center);
          for (const edge of graph.edges) {
            const other =
              edge.from === goal.key
                ? edge.to
                : edge.to === goal.key
                  ? edge.from
                  : null;
            const point = other ? layout.nodes.get(other) : undefined;
            if (point) points.push(point);
          }
          const box = pointBox(points, 110);
          return box.width < 420
            ? pointBox(points, 110 + (420 - box.width) / 2)
            : box;
        }
        case "keys": {
          const points = goal.keys.flatMap((key) => {
            const point = layout.nodes.get(key);
            return point ? [point] : [];
          });
          if (points.length === 0) return OVERVIEW;
          const box = pointBox(points, 130);
          return box.width < 520
            ? pointBox(points, 130 + (520 - box.width) / 2)
            : box;
        }
      }
    },
    [graph.edges, layout],
  );

  const goalId = targetId(target);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fly only when the target itself changes, not as Nodes stream in
  useEffect(() => {
    flyTo(boxFor(target));
  }, [goalId, size.width, size.height]);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    paint(
      fitAspect(
        OVERVIEW,
        (element.clientWidth || 800) / (element.clientHeight || 600),
      ),
    );
    settle();
    return () => observer.disconnect();
  }, [paint, settle]);

  // Wheel zoom about the pointer, drag to pan --------------------------------------

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    let frame = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stop.current?.();
      const rect = element.getBoundingClientRect();
      const box = camera.current;
      const px = box.x + ((event.clientX - rect.left) / rect.width) * box.width;
      const py =
        box.y + ((event.clientY - rect.top) / rect.height) * box.height;
      const factor = Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0016));
      const width = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, box.width * factor),
      );
      const scale = width / box.width;
      paint({
        x: px - (px - box.x) * scale,
        y: py - (py - box.y) * scale,
        width,
        height: box.height * scale,
      });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(settle);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, [paint, settle]);

  const drag = useRef<{
    x: number;
    y: number;
    box: Box;
    moved: boolean;
  } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    stop.current?.();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      box: camera.current,
      moved: false,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || !svg.current) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    if (!start.moved) svg.current.setPointerCapture(event.pointerId);
    start.moved = true;
    const rect = svg.current.getBoundingClientRect();
    paint({
      ...start.box,
      x: start.box.x - (dx / rect.width) * start.box.width,
      y: start.box.y - (dy / rect.height) * start.box.height,
    });
  };
  const wasDrag = () => {
    const moved = drag.current?.moved ?? false;
    drag.current = null;
    return moved;
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (svg.current?.hasPointerCapture(event.pointerId)) {
      svg.current.releasePointerCapture(event.pointerId);
    }
    const moved = wasDrag();
    if (moved) return;
    // A click on empty space steps back out one level.
    if ((event.target as Element).closest("[data-hit]")) return;
    if (selected) onSelect(null);
    else if (target.kind === "leaf")
      onTarget({ kind: "branch", id: target.id.split(".")[0] ?? "" });
    else if (target.kind !== "overview") onTarget({ kind: "overview" });
  };

  const zoomBy = (factor: number) => {
    const box = camera.current;
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, box.width * factor));
    const scale = width / box.width;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const goal = {
      x: cx - width / 2,
      y: cy - (box.height * scale) / 2,
      width,
      height: box.height * scale,
    };
    flyTo(goal);
  };

  // Drawing ----------------------------------------------------------------------

  const zoom = OVERVIEW.width / Math.max(1, unit * size.width);
  const fontPx = (px: number) => px * unit;
  const showNodeLabels = zoom > 1.9;

  const edgeState = (edge: DraftEdge) => {
    const key = edgeKey(edge);
    const glow = highlight.edges.get(key);
    const touchesSelected =
      !!selected && (edge.from === selected || edge.to === selected);
    const fromNode = nodeByKey.get(edge.from);
    const toNode = nodeByKey.get(edge.to);
    const inFocus =
      !!focusBranch &&
      ((fromNode && branchOf(fromNode.category) === focusBranch) ||
        (toNode && branchOf(toNode.category) === focusBranch));
    return { key, glow, touchesSelected, inFocus };
  };

  const nodeOpacity = (node: DraftNode) => {
    if (node.key === ROOT_KEY) return 1;
    if (hovered === node.key) return 1;
    if (neighbours) return neighbours.has(node.key) ? 1 : 0.14;
    if (lit) return highlight.nodes.has(node.key) ? 1 : 0.16;
    if (focusLeaf) return node.category === focusLeaf ? 1 : 0.18;
    if (focusBranch) return branchOf(node.category) === focusBranch ? 1 : 0.2;
    return 0.9;
  };

  const labelVisible = (node: DraftNode) =>
    hovered === node.key ||
    showNodeLabels ||
    (neighbours?.has(node.key) ?? false) ||
    highlight.nodes.has(node.key) ||
    (focusLeaf ? node.category === focusLeaf : false) ||
    (focusBranch
      ? branchOf(node.category) === focusBranch && zoom > 1.3
      : false);

  // Read by Nodes as they exit: a merged Node flies into the one it joined.
  const exitContext = useMemo<ExitContext>(
    () => ({
      departing: new Map(departures.map((item) => [item.key, item])),
      positions: layout.nodes,
    }),
    [departures, layout.nodes],
  );

  const now = Date.now();
  const callouts = recent.filter((item) => now - item.at < 5200);
  const branchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) {
      if (node.key === ROOT_KEY) continue;
      const branch = branchOf(node.category);
      counts.set(branch, (counts.get(branch) ?? 0) + 1);
    }
    return counts;
  }, [graph.nodes]);
  const leafCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) {
      if (node.key !== ROOT_KEY)
        counts.set(node.category, (counts.get(node.category) ?? 0) + 1);
    }
    return counts;
  }, [graph.nodes]);

  return (
    <div
      ref={wrap}
      className="relative h-full w-full overflow-hidden bg-marble"
    >
      <svg
        ref={svg}
        role="img"
        data-testid="client-graph"
        data-nodes={graph.nodes.length}
        aria-label={`${clientName}'s Client graph: ${graph.nodes.length} Nodes in ${branchCounts.size} Branches`}
        className="cm-canvas block h-full w-full cursor-grab active:cursor-grabbing"
        viewBox={viewBoxOf(OVERVIEW)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => wasDrag()}
      >
        <defs>
          <pattern
            id="cm-dots"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" fill="#14213d" opacity="0.09" />
          </pattern>
          <radialGradient id="cm-glow">
            <stop offset="0%" stopColor="#d9a84e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#d9a84e" stopOpacity="0" />
          </radialGradient>
          <clipPath id="cm-root-clip">
            <circle r="50" />
          </clipPath>
          <filter id="cm-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* Ground: dot grid, the orbit Branches sit on, and a slow outer ring. */}
        <rect
          x={-4000}
          y={-4000}
          width={8000}
          height={8000}
          fill="url(#cm-dots)"
        />
        <circle r={520} fill="url(#cm-glow)" />
        <circle
          r={470}
          fill="none"
          stroke="#14213d"
          strokeOpacity={0.12}
          strokeWidth={1.5}
          strokeDasharray="3 9"
        />
        <g className="cm-orbit">
          <circle
            r={720}
            fill="none"
            stroke="#1d4e89"
            strokeOpacity={0.12}
            strokeWidth={1.2}
            strokeDasharray="1 14"
          />
          {!reduce ? (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 0 0"
              to="360 0 0"
              dur="160s"
              repeatCount="indefinite"
            />
          ) : null}
        </g>

        {/* The Category tree: Root → Branch → leaf → Node. */}
        <g>
          {layout.branches.map((branch) => {
            const tone =
              TONE_HEX[
                BRANCHES.find((item) => item.id === branch.id)?.tone ?? "stone"
              ];
            const active = focusBranch === branch.id;
            return (
              <line
                key={`spoke-${branch.id}`}
                x1={0}
                y1={0}
                x2={branch.x}
                y2={branch.y}
                stroke={tone}
                strokeWidth={active ? 3 : 1.6}
                strokeOpacity={focusBranch && !active ? 0.12 : 0.4}
                className="cm-march cm-fade"
              />
            );
          })}
          {layout.leaves.map((leaf) => {
            const hub = layout.branches.find(
              (branch) => branch.id === leaf.branchId,
            );
            if (!hub) return null;
            const tone = toneOf(leaf.id);
            const filled = (leafCounts.get(leaf.id) ?? 0) > 0;
            return (
              <line
                key={`twig-${leaf.id}`}
                x1={hub.x}
                y1={hub.y}
                x2={leaf.x}
                y2={leaf.y}
                stroke={tone}
                strokeWidth={1.2}
                strokeOpacity={
                  filled
                    ? focusBranch && focusBranch !== leaf.branchId
                      ? 0.1
                      : 0.35
                    : 0.1
                }
                className="cm-fade"
              />
            );
          })}
          {graph.nodes.map((node) => {
            if (node.key === ROOT_KEY) return null;
            const point = layout.nodes.get(node.key);
            const leaf = layout.leaves.find(
              (item) => item.id === node.category,
            );
            if (!point || !leaf) return null;
            return (
              <motion.line
                key={`stem-${node.key}`}
                initial={{ x1: leaf.x, y1: leaf.y, x2: leaf.x, y2: leaf.y }}
                animate={{ x1: leaf.x, y1: leaf.y, x2: point.x, y2: point.y }}
                transition={{ type: "spring", stiffness: 120, damping: 18 }}
                stroke={toneOf(node.category)}
                strokeWidth={0.8}
                strokeOpacity={nodeOpacity(node) * 0.3}
                className="cm-fade"
              />
            );
          })}
        </g>

        {/* Relations between Nodes. */}
        <g fill="none">
          {graph.edges.map((edge) => {
            const from = layout.nodes.get(edge.from);
            const to = layout.nodes.get(edge.to);
            if (!from || !to) return null;
            const state = edgeState(edge);
            const d = curve(from, to);
            const base = state.touchesSelected
              ? 0.8
              : selected
                ? 0.04
                : lit
                  ? 0.06
                  : state.inFocus
                    ? 0.42
                    : focusBranch
                      ? 0.05
                      : 0.13;
            const glowTone =
              state.glow?.glow === "path" ? "#b23a2b" : "#d9a84e";
            return (
              <g key={state.key}>
                <path
                  d={d}
                  stroke={
                    state.touchesSelected
                      ? toneOf(
                          nodeByKey.get(
                            edge.to === selected ? edge.from : edge.to,
                          )?.category ?? "",
                        )
                      : "#14213d"
                  }
                  strokeOpacity={state.glow ? 0.15 : base}
                  strokeWidth={Math.max(
                    1,
                    (state.touchesSelected ? 2.2 : 1.2) *
                      Math.min(1, unit * 1.4),
                  )}
                  className="cm-fade"
                />
                {state.glow ? (
                  <>
                    <motion.path
                      d={d}
                      stroke={glowTone}
                      strokeWidth={Math.max(3, unit * 3.2)}
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 0.9 }}
                      transition={{
                        duration: 0.6,
                        delay: reduce ? 0 : state.glow.order * 0.09,
                        ease: "easeOut",
                      }}
                    />
                    <path
                      d={d}
                      pathLength={1}
                      stroke="#fff"
                      strokeWidth={Math.max(2, unit * 2.4)}
                      strokeLinecap="round"
                      className="cm-comet"
                      style={{ animationDelay: `${state.glow.order * 0.09}s` }}
                    />
                  </>
                ) : null}
                {(state.touchesSelected || state.glow?.glow === "path") &&
                zoom > 1.2 ? (
                  <text
                    x={((from.x + to.x) / 2) * 0.86}
                    y={((from.y + to.y) / 2) * 0.86}
                    textAnchor="middle"
                    fill="#4a4f5b"
                    style={{ fontSize: fontPx(10), strokeWidth: fontPx(3) }}
                    className="font-mono"
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* Branch and leaf hubs. */}
        <g>
          {layout.branches.map((branch) => {
            const meta = BRANCHES.find((item) => item.id === branch.id);
            if (!meta) return null;
            const tone = TONE_HEX[meta.tone];
            const count = branchCounts.get(branch.id) ?? 0;
            const active = focusBranch === branch.id;
            const dim = (focusBranch && !active) || (lit && !active);
            // Labels sit on the inner side of the hub: the leaves fan outward.
            const labelOffset = 64;
            const lx = branch.x - Math.cos(branch.angle) * labelOffset;
            const ly = branch.y - Math.sin(branch.angle) * labelOffset;
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG group can't be a <button>
              <g
                key={branch.id}
                data-hit
                role="button"
                tabIndex={0}
                aria-label={`${meta.label}: ${count} Nodes`}
                className="cursor-pointer outline-none"
                onClick={() => onTarget({ kind: "branch", id: branch.id })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    onTarget({ kind: "branch", id: branch.id });
                }}
                opacity={dim ? 0.45 : 1}
                style={{ transition: "opacity .45s" }}
              >
                <circle
                  cx={branch.x}
                  cy={branch.y}
                  r={active ? 44 : 36}
                  fill={tone}
                  fillOpacity={0.14}
                  stroke={tone}
                  strokeWidth={active ? 4 : 2.5}
                  className="cm-fade"
                  style={{ transition: "r .4s" }}
                />
                <circle
                  cx={branch.x}
                  cy={branch.y}
                  r={22}
                  fill="#fff"
                  stroke="#14213d"
                  strokeWidth={2}
                />
                <text
                  x={branch.x}
                  y={branch.y + 5.5}
                  textAnchor="middle"
                  fill="#14213d"
                  style={{ fontSize: 16, strokeWidth: 0 }}
                  className="font-mono font-bold"
                >
                  {count}
                </text>
                <text
                  x={lx}
                  y={ly + 4}
                  textAnchor="middle"
                  fill="#14213d"
                  style={{
                    fontSize: Math.max(15, fontPx(13)),
                    strokeWidth: Math.max(4, fontPx(4)),
                  }}
                  className="font-mono font-bold uppercase"
                >
                  {meta.label}
                </text>
              </g>
            );
          })}
          {layout.leaves.map((leaf) => {
            const count = leafCounts.get(leaf.id) ?? 0;
            const tone = toneOf(leaf.id);
            const inBranch = focusBranch === leaf.branchId;
            const showLabel =
              (inBranch || zoom > 1.5) && (count > 0 || inBranch);
            const { leaf: name } = categoryLabel(leaf.id);
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG group can't be a <button>
              <g
                key={leaf.id}
                data-hit
                role="button"
                tabIndex={-1}
                aria-label={`${name}: ${count} Nodes`}
                className="cursor-pointer"
                onClick={() => onTarget({ kind: "leaf", id: leaf.id })}
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    onTarget({ kind: "leaf", id: leaf.id });
                }}
                opacity={
                  count === 0 ? 0.35 : focusBranch && !inBranch ? 0.3 : 1
                }
                style={{ transition: "opacity .45s" }}
              >
                <rect
                  x={leaf.x - (focusLeaf === leaf.id ? 12 : 8)}
                  y={leaf.y - (focusLeaf === leaf.id ? 12 : 8)}
                  width={focusLeaf === leaf.id ? 24 : 16}
                  height={focusLeaf === leaf.id ? 24 : 16}
                  rx={2}
                  transform={`rotate(45 ${leaf.x} ${leaf.y})`}
                  fill={count > 0 ? "#fff" : "#f5f1e8"}
                  stroke={count > 0 ? tone : "#8a8478"}
                  strokeWidth={count > 0 ? 3 : 1.5}
                  strokeDasharray={count > 0 ? undefined : "3 3"}
                  style={{ transition: "all .35s" }}
                />
                {showLabel ? (
                  <text
                    x={leaf.x}
                    y={leaf.y - 18}
                    textAnchor="middle"
                    fill="#14213d"
                    style={{
                      fontSize: Math.max(11, fontPx(11)),
                      strokeWidth: Math.max(3, fontPx(3.5)),
                    }}
                    className="font-mono font-bold uppercase"
                  >
                    {name}
                    {count > 0 ? ` · ${count}` : ""}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* Nodes. */}
        <g>
          <AnimatePresence custom={exitContext}>
            {graph.nodes.map((node, index) => {
              if (node.key === ROOT_KEY) return null;
              const point = layout.nodes.get(node.key);
              const leaf = layout.leaves.find(
                (item) => item.id === node.category,
              );
              if (!point || !leaf) return null;
              const tone = toneOf(node.category);
              const radius = Math.max(
                NODE_RADIUS[node.type] ?? 8.5,
                unit * 4.5,
              );
              const glow = highlight.nodes.get(node.key);
              const isSelected = selected === node.key;
              const opacity = nodeOpacity(node);
              const order = arrivals?.[node.key] ?? index;
              return (
                <NodeMark
                  key={node.key}
                  node={node}
                  point={point}
                  spawn={leaf}
                  tone={tone}
                  radius={radius}
                  opacity={opacity}
                  glow={glow?.glow}
                  glowOrder={glow?.order ?? 0}
                  selected={isSelected}
                  hovered={hovered === node.key}
                  label={labelVisible(node)}
                  unit={unit}
                  delay={
                    reduce ? 0 : building ? 0 : Math.min(order * 0.025, 1.2)
                  }
                  onSelect={onSelect}
                />
              );
            })}
          </AnimatePresence>
        </g>

        {/* The client at the centre. */}
        {/* biome-ignore lint/a11y/useSemanticElements: an SVG group can't be a <button> */}
        <g
          data-hit
          role="button"
          tabIndex={0}
          aria-label={clientName}
          className="cursor-pointer"
          onClick={() => onSelect(ROOT_KEY)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSelect(ROOT_KEY);
          }}
        >
          {building ? (
            <circle r={78} fill="#d9a84e" className="cm-breathe" />
          ) : null}
          {highlight.nodes.has(ROOT_KEY) ? (
            <circle
              r={56}
              fill="none"
              stroke="#d9a84e"
              strokeWidth={4}
              className="cm-ripple"
            />
          ) : null}
          <circle
            r={56}
            fill="#fff"
            stroke="#14213d"
            strokeWidth={selected === ROOT_KEY ? 6 : 4}
          />
          {portraitUrl ? (
            <image
              href={portraitUrl}
              x={-50}
              y={-50}
              width={100}
              height={100}
              clipPath="url(#cm-root-clip)"
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <text
              y={12}
              textAnchor="middle"
              fill="#1d4e89"
              style={{ fontSize: 34, strokeWidth: 0 }}
              className="font-mono font-bold"
            >
              {initials(clientName)}
            </text>
          )}
          <rect
            x={-Math.max(70, clientName.length * 5.4)}
            y={64}
            width={Math.max(140, clientName.length * 10.8)}
            height={26}
            rx={2}
            fill="#14213d"
          />
          <text
            y={82}
            textAnchor="middle"
            fill="#fff"
            style={{ fontSize: 14, strokeWidth: 0 }}
            className="font-mono font-bold uppercase"
          >
            {clientName}
          </text>
        </g>

        {/* What a Repair just did, floating over the Nodes it touched. */}
        <g>
          <AnimatePresence>
            {callouts.map((item) => {
              const point = item.keys
                .map((key) => layout.nodes.get(key))
                .find(Boolean);
              if (!point) return null;
              const width = item.text.length * fontPx(6.6) + fontPx(14);
              return (
                <motion.g
                  key={`${item.at}-${item.text}-${item.keys.join("+")}`}
                  initial={{ opacity: 0, y: point.y }}
                  animate={{ opacity: 1, y: point.y - fontPx(26) }}
                  exit={{ opacity: 0, y: point.y - fontPx(46) }}
                  transition={{ duration: 0.5 }}
                >
                  <rect
                    x={point.x - width / 2}
                    y={-fontPx(11)}
                    width={width}
                    height={fontPx(20)}
                    fill={item.tone}
                    rx={fontPx(2)}
                    stroke="#14213d"
                    strokeWidth={fontPx(1.5)}
                  />
                  <text
                    x={point.x}
                    y={fontPx(4)}
                    textAnchor="middle"
                    fill="#fff"
                    style={{ fontSize: fontPx(11), strokeWidth: 0 }}
                    className="font-mono font-bold uppercase"
                  >
                    {item.text}
                  </text>
                </motion.g>
              );
            })}
          </AnimatePresence>
        </g>
      </svg>

      {/* Zoom controls and the minimap. */}
      <div className="pointer-events-none absolute right-3 bottom-3 flex items-end gap-2">
        <div className="outline-box pointer-events-auto hidden overflow-hidden rounded-sm bg-paper/90 shadow-hard-sm sm:block">
          <svg
            viewBox={viewBoxOf(OVERVIEW)}
            className="block h-24 w-32"
            aria-hidden="true"
          >
            {layout.branches.map((branch) => (
              <circle
                key={branch.id}
                cx={branch.x}
                cy={branch.y}
                r={34}
                fill={
                  TONE_HEX[
                    BRANCHES.find((item) => item.id === branch.id)?.tone ??
                      "stone"
                  ]
                }
                fillOpacity={0.5}
              />
            ))}
            {[...layout.nodes.entries()].map(([key, point]) => (
              <circle
                key={key}
                cx={point.x}
                cy={point.y}
                r={9}
                fill="#14213d"
                opacity={0.6}
              />
            ))}
            <rect
              ref={mini}
              fill="#1d4e89"
              fillOpacity={0.12}
              stroke="#1d4e89"
              strokeWidth={14}
            />
          </svg>
        </div>
        <div className="outline-box pointer-events-auto flex flex-col overflow-hidden rounded-sm bg-paper shadow-hard-sm">
          {[
            { label: "Zoom in", text: "+", action: () => zoomBy(0.6) },
            { label: "Zoom out", text: "−", action: () => zoomBy(1.6) },
            {
              label: "Fit the whole graph",
              text: "⤢",
              action: () => onTarget({ kind: "overview" }),
            },
          ].map((control) => (
            <button
              key={control.label}
              type="button"
              aria-label={control.label}
              title={control.label}
              onClick={() => {
                if (control.text === "⤢") {
                  onSelect(null);
                  if (target.kind === "overview") flyTo(OVERVIEW);
                }
                control.action();
              }}
              className="flex size-9 items-center justify-center border-ink font-mono text-lg font-bold not-last:border-b-2 hover:bg-morning-haze"
            >
              {control.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type ExitContext = {
  departing: Map<string, Departure>;
  positions: Map<string, Point>;
};

function NodeMark({
  node,
  point,
  spawn,
  tone,
  radius,
  opacity,
  glow,
  glowOrder,
  selected,
  hovered,
  label,
  unit,
  delay,
  onSelect,
}: {
  node: DraftNode;
  point: Point;
  spawn: Point;
  tone: string;
  radius: number;
  opacity: number;
  glow: string | undefined;
  glowOrder: number;
  selected: boolean;
  hovered: boolean;
  label: boolean;
  unit: number;
  delay: number;
  onSelect: (key: string) => void;
}) {
  const variants = {
    exit: (context: ExitContext | undefined) => {
      const departure = context?.departing.get(node.key);
      const into = departure?.into
        ? context?.positions.get(departure.into)
        : undefined;
      if (into) {
        return {
          x: into.x,
          y: into.y,
          scale: 0.2,
          opacity: 0,
          transition: { duration: 0.9, ease: "easeIn" as const },
        };
      }
      if (departure) {
        return {
          scale: [1, 1.9, 0],
          opacity: [1, 1, 0],
          transition: { duration: 0.8 },
        };
      }
      return { scale: 0, opacity: 0, transition: { duration: 0.3 } };
    },
  };
  const ring = glow === "path" ? "#b23a2b" : glow ? "#d9a84e" : "#14213d";
  const font = Math.max(10, 11.5 * unit);
  const glowDelay = `${glowOrder * 0.09}s`;
  return (
    <motion.g
      initial={{ x: spawn.x, y: spawn.y, scale: 0, opacity: 0 }}
      animate={{ x: point.x, y: point.y, scale: 1, opacity }}
      variants={variants}
      exit="exit"
      transition={{
        x: { type: "spring", stiffness: 110, damping: 17, delay },
        y: { type: "spring", stiffness: 110, damping: 17, delay },
        scale: { type: "spring", stiffness: 260, damping: 16, delay },
        opacity: {
          duration: 0.4,
          delay: opacity === 1 || opacity === 0.9 ? delay : 0,
        },
      }}
      data-hit
      role="button"
      tabIndex={-1}
      aria-label={`${node.label}, ${categoryLabel(node.category).leaf}`}
      className="cursor-pointer"
      onClick={() => onSelect(node.key)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect(node.key);
      }}
    >
      {glow === "seed" ? (
        <circle
          r={radius + 2}
          fill="none"
          stroke="#d9a84e"
          strokeWidth={3}
          className="cm-ripple"
          style={{ animationDelay: glowDelay }}
        />
      ) : null}
      {glow ? (
        <motion.circle
          r={radius + 6}
          fill={ring}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 0.28, scale: 1 }}
          transition={{ delay: glowOrder * 0.09, duration: 0.4 }}
        />
      ) : null}
      {selected ? (
        <circle r={radius + 7} fill="none" stroke={tone} strokeWidth={3} />
      ) : null}
      {hovered ? (
        <circle r={radius + 5} fill="none" stroke="#1d4e89" strokeWidth={2.5} />
      ) : null}
      <circle
        r={radius}
        fill={glow || selected ? tone : "#fff"}
        stroke={glow ? ring : tone}
        strokeWidth={glow ? 3.2 : 2.4}
        style={{ transition: "fill .4s" }}
      />
      {glow === "read" ? (
        <circle
          r={radius + 10}
          fill="none"
          stroke="#1d4e89"
          strokeWidth={2}
          className="cm-read"
        />
      ) : null}
      {!glow && !selected ? <circle r={radius * 0.38} fill={tone} /> : null}
      {label ? (
        <text
          x={radius + 5}
          y={font * 0.35}
          fill="#14213d"
          style={{ fontSize: font, strokeWidth: font * 0.32 }}
          className="font-sans font-semibold"
        >
          {node.label.length > 34 ? `${node.label.slice(0, 32)}…` : node.label}
        </text>
      ) : null}
    </motion.g>
  );
}
