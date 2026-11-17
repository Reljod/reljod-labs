import {
  levels,
  type PipelineSpec,
  type StepSpec,
} from "../../domain/pipeline";
import type { RunView } from "../../domain/run";
import { humanize } from "./format";

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 84;
export const GAP_X = 32;
export const GAP_Y = 56;

export type PlacedStep = {
  step: StepSpec;
  /** Which level (row) it runs in; Steps of one level run at the same time. */
  level: number;
  /** Its place within the level, left to right. */
  index: number;
  x: number;
  y: number;
};

export type PipelineLayout = {
  nodes: PlacedStep[];
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
): PipelineLayout {
  let rows: StepSpec[][];
  try {
    rows = levels(spec);
  } catch (caught) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
      parallelism: 0,
      problem:
        caught instanceof Error ? caught.message : "The Steps cannot be drawn.",
    };
  }
  const parallelism = rows.reduce((most, row) => Math.max(most, row.length), 0);
  const width = parallelism * NODE_WIDTH + Math.max(0, parallelism - 1) * GAP_X;
  const nodes: PlacedStep[] = rows.flatMap((row, level) => {
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * GAP_X;
    const left = (width - rowWidth) / 2;
    return row.map((step, index) => ({
      step,
      level,
      index,
      x: left + index * (NODE_WIDTH + GAP_X),
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
  return {
    nodes,
    edges,
    width,
    height: rows.length * NODE_HEIGHT + Math.max(0, rows.length - 1) * GAP_Y,
    parallelism,
    problem: null,
  };
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
