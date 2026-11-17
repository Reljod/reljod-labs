import type { RunStatus } from "../../domain/run";
import type { PipelineLayout } from "./layout";

/*
 * Where a Pipeline is, level by level, and a made-up Run for the preview.
 * Pure: the graph and its progress rail read these, and nothing here knows
 * about React.
 */

/** What a Step's node can show (see `nodeState` in flow.tsx). */
export type StepState =
  | "pending"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "skipped";

export type SegmentState = "idle" | "pending" | "active" | "done" | "failed";

export type Rail = {
  /** 1-based level the Run is at (the first not finished); the last when all are. */
  current: number;
  total: number;
  /** Steps running together at the current level. */
  parallel: number;
  segments: SegmentState[];
  label: string;
  /** What the rail says besides the level, in words. */
  detail: string;
};

const finished = (state: StepState | null) =>
  state === "done" || state === "skipped";

/** The rows of Step ids per level, from the layout. */
function rowsOf(layout: Pick<PipelineLayout, "nodes" | "levels">) {
  const rows: string[][] = Array.from({ length: layout.levels }, () => []);
  for (const placed of layout.nodes) rows[placed.level]?.push(placed.step.id);
  return rows;
}

/**
 * The rail for a Run, a play-through or a plain preview (`states` null).
 * `at` is how it is being watched: with no states it is the Pipeline's shape.
 */
export function railOf(
  layout: Pick<PipelineLayout, "nodes" | "levels" | "parallelism">,
  states: ReadonlyMap<string, StepState> | null,
  runStatus: RunStatus | null = null,
): Rail {
  const rows = rowsOf(layout);
  const total = rows.length;
  if (!states) {
    return {
      current: 0,
      total,
      parallel: layout.parallelism,
      segments: rows.map(() => "idle"),
      label: `${total} levels`,
      detail:
        layout.parallelism > 1
          ? `up to ${layout.parallelism} Steps at once`
          : "one Step at a time",
    };
  }
  const segments: SegmentState[] = rows.map((ids) => {
    const own = ids.map((id) => states.get(id) ?? "pending");
    if (own.some((state) => state === "failed")) return "failed";
    if (own.every(finished)) return "done";
    if (own.some((state) => state === "running" || state === "waiting")) {
      return "active";
    }
    return "pending";
  });
  const failedAt = segments.indexOf("failed");
  const firstOpen = segments.findIndex((segment) => segment !== "done");
  const index =
    failedAt >= 0 ? failedAt : firstOpen >= 0 ? firstOpen : total - 1;
  const here = rows[index] ?? [];
  const waiting = here.some((id) => states.get(id) === "waiting");
  const allDone = firstOpen < 0 && failedAt < 0;
  const parallel = here.length;
  let detail: string;
  if (failedAt >= 0) detail = "a Step failed here";
  else if (allDone) detail = "all Steps are done";
  else if (waiting) detail = "waiting for a person's Approval";
  else if (segments[index] === "active")
    detail = parallel > 1 ? `${parallel} Steps at once` : "running";
  else if (runStatus === "queued") detail = "queued";
  else detail = "about to start";
  return {
    current: total === 0 ? 0 : index + 1,
    total,
    parallel,
    segments,
    label: allDone
      ? `All ${total} levels done`
      : `Level ${index + 1} of ${total}`,
    detail,
  };
}

// The play-through ---------------------------------------------------------------

/** How long each level takes in the preview's play-through. */
export const PLAY_LEVEL_MS = 1200;

export type Simulation = {
  states: Map<string, StepState>;
  /** How long each Step has been running, for the ones at work or done. */
  elapsed: Map<string, number>;
  finished: boolean;
};

/**
 * What a made-up Run looks like `elapsedMs` after it starts: one level at a
 * time, the Steps of a level all running together, an Approval Step waiting
 * for a moment before it clears. Nothing is called and nothing is spent.
 */
export function simulate(
  layout: Pick<PipelineLayout, "nodes" | "levels">,
  elapsedMs: number,
): Simulation {
  const states = new Map<string, StepState>();
  const elapsed = new Map<string, number>();
  const level = Math.floor(elapsedMs / PLAY_LEVEL_MS);
  const done = level >= layout.levels;
  for (const placed of layout.nodes) {
    const id = placed.step.id;
    if (placed.level < level || done) {
      states.set(id, "done");
      elapsed.set(id, PLAY_LEVEL_MS);
    } else if (placed.level === level) {
      const into = elapsedMs - level * PLAY_LEVEL_MS;
      states.set(id, placed.step.kind === "approval" ? "waiting" : "running");
      elapsed.set(id, into);
    } else {
      states.set(id, "pending");
    }
  }
  return { states, elapsed, finished: done };
}
