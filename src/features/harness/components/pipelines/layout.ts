import {
  levels,
  type PipelineSpec,
  type StepSpec,
} from "../../domain/pipeline";
import type { RunView } from "../../domain/run";
import { humanize } from "./format";

/** A Step card's least width; `fitGraph` widens it when there is room. */
export const NODE_WIDTH = 236;
export const MAX_NODE_WIDTH = 320;
export const NODE_HEIGHT = 100;
export const GAP_X = 32;
export const GAP_Y = 60;
/** The graph's room around the Steps, in graph units. */
export const GRAPH_PAD = 24;
/** Below this zoom a Step's text is too small to read; the graph then pans sideways instead. */
export const MIN_ZOOM = 0.82;
/** Above this the cards widen instead of the text growing. */
export const MAX_ZOOM = 1;
/** Room around the Steps of a level for its band. */
export const BAND_PAD = 14;

export type PlacedStep = {
  step: StepSpec;
  /** Which level (row) it runs in; Steps of one level run at the same time. */
  level: number;
  /** Its place within the level, left to right. */
  index: number;
  x: number;
  y: number;
};

/** The band behind a level whose Steps run together. */
export type LevelBand = {
  level: number;
  /** How many Steps run at once. */
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PipelineLayout = {
  nodes: PlacedStep[];
  /** One per level with more than one Step. */
  bands: LevelBand[];
  /** How many levels (rows) there are. */
  levels: number;
  edges: { id: string; source: string; target: string }[];
  width: number;
  height: number;
  /** The widest level: how many Steps run side by side at most. */
  parallelism: number;
  /** Why the Steps cannot be drawn (a cycle, an unknown Step), or null. */
  problem: string | null;
};

/**
 * Lays a Pipeline out from `levels(spec)`: one row per level, the Steps of a
 * level side by side and centred, so the parallelism is visible. An invalid
 * graph comes back empty with the reason, never throws.
 */
export function layoutPipeline(
  spec: Pick<PipelineSpec, "steps">,
  nodeWidth: number = NODE_WIDTH,
): PipelineLayout {
  let rows: StepSpec[][];
  try {
    rows = levels(spec);
  } catch (caught) {
    return {
      nodes: [],
      bands: [],
      levels: 0,
      edges: [],
      width: 0,
      height: 0,
      parallelism: 0,
      problem:
        caught instanceof Error ? caught.message : "The Steps cannot be drawn.",
    };
  }
  const parallelism = rows.reduce((most, row) => Math.max(most, row.length), 0);
  const width = parallelism * nodeWidth + Math.max(0, parallelism - 1) * GAP_X;
  const nodes: PlacedStep[] = rows.flatMap((row, level) => {
    const rowWidth = row.length * nodeWidth + (row.length - 1) * GAP_X;
    const left = (width - rowWidth) / 2;
    return row.map((step, index) => ({
      step,
      level,
      index,
      x: left + index * (nodeWidth + GAP_X),
      y: level * (NODE_HEIGHT + GAP_Y),
    }));
  });
  const edges = spec.steps.flatMap((step) =>
    step.after.map((before) => ({
      id: `${before}->${step.id}`,
      source: before,
      target: step.id,
    })),
  );
  const bands: LevelBand[] = rows.flatMap((row, level) => {
    if (row.length < 2) return [];
    const rowWidth = row.length * nodeWidth + (row.length - 1) * GAP_X;
    return [
      {
        level,
        count: row.length,
        x: (width - rowWidth) / 2 - BAND_PAD,
        y: level * (NODE_HEIGHT + GAP_Y) - BAND_PAD,
        width: rowWidth + 2 * BAND_PAD,
        height: NODE_HEIGHT + 2 * BAND_PAD,
      },
    ];
  });
  return {
    nodes,
    bands,
    levels: rows.length,
    edges,
    width,
    height: rows.length * NODE_HEIGHT + Math.max(0, rows.length - 1) * GAP_Y,
    parallelism,
    problem: null,
  };
}

/** How a graph sits in a box `boxWidth` wide (screen pixels). */
export type GraphFit = {
  /** The width to lay each Step card out at. */
  nodeWidth: number;
  zoom: number;
  /** The graph is wider than the box even at `MIN_ZOOM`: it pans sideways. */
  pan: boolean;
};

/**
 * Fits a graph whose widest level has `parallelism` Steps to a box: shrink
 * (down to `MIN_ZOOM`, where the text is still readable) when it is narrow,
 * widen the cards (up to `MAX_NODE_WIDTH`, at `MAX_ZOOM`) when it is wide, so
 * the graph spans the box at every width. Narrower than that, it pans.
 */
export function fitGraph(boxWidth: number, parallelism: number): GraphFit {
  const across = Math.max(1, parallelism);
  const span = (nodeWidth: number) =>
    across * nodeWidth + (across - 1) * GAP_X + 2 * GRAPH_PAD;
  if (!(boxWidth > 0)) return { nodeWidth: NODE_WIDTH, zoom: 1, pan: false };
  const zoom = boxWidth / span(NODE_WIDTH);
  if (zoom >= MAX_ZOOM) {
    const room =
      (boxWidth / MAX_ZOOM - 2 * GRAPH_PAD - (across - 1) * GAP_X) / across;
    return {
      nodeWidth: Math.floor(
        Math.min(MAX_NODE_WIDTH, Math.max(NODE_WIDTH, room)),
      ),
      zoom: MAX_ZOOM,
      pan: false,
    };
  }
  if (zoom >= MIN_ZOOM) return { nodeWidth: NODE_WIDTH, zoom, pan: false };
  return { nodeWidth: NODE_WIDTH, zoom: MIN_ZOOM, pan: true };
}

/**
 * The Steps to draw for a Run: its Pipeline's spec, or, when the Pipeline is
 * not known to this build, a plain chain of the Steps the Run reports.
 */
export function specForRun(
  spec: PipelineSpec | null,
  run: Pick<RunView, "steps">,
): Pick<PipelineSpec, "steps"> {
  if (spec) return spec;
  return {
    steps: run.steps.map((step, index) => {
      const before = run.steps[index - 1];
      return {
        id: step.stepId,
        title: humanize(step.stepId),
        kind: "code" as const,
        after: before ? [before.stepId] : [],
        summary: "",
      };
    }),
  };
}
