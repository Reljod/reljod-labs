import type { Pace } from "./build-plan";
import type { ContentKind } from "./content-tree";

export type TravelPose = "run" | "run-down" | "run-up" | "fly";
export type Grip = "carry" | "drag";

export type Gait = {
  pose: TravelPose;
  /** Facing left. */
  flip: boolean;
  /** Tilt in degrees, only when flying a diagonal. */
  rot: number;
  /** Seconds. */
  duration: number;
};

const SPEED: Record<TravelPose, number> = {
  run: 400,
  "run-down": 320,
  "run-up": 320,
  fly: 520,
};
const PACE: Record<Pace, number> = { stroll: 0.65, trot: 1, dash: 1.45 };
/** Hauling a block slows him down; dragging a big one slows him more. */
const LOAD: Record<Grip, number> = { carry: 0.8, drag: 0.55 };
const MIN_DURATION = 0.45;

/**
 * Direction picks the view: under 25° from horizontal he gallops side-on,
 * over 60° he runs in top or bottom view, anything between he flies.
 */
export function chooseGait(dx: number, dy: number, pace: Pace = "trot"): Gait {
  const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  const distance = Math.hypot(dx, dy);
  let pose: TravelPose;
  let flip = false;
  let rot = 0;
  if (angle < 25) {
    pose = "run";
    flip = dx < 0;
  } else if (angle > 60) {
    pose = dy > 0 ? "run-down" : "run-up";
  } else {
    pose = "fly";
    flip = dx < 0;
    rot = Math.round((Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI) + 8;
  }
  return {
    pose,
    flip,
    rot,
    duration: travelTime(distance, SPEED[pose] * PACE[pace]),
  };
}

/** Small pieces go overhead; whole cards and jobs get dragged. */
export function gripFor(kind: ContentKind): Grip {
  return kind === "figure" || kind === "quote" ? "carry" : "drag";
}

/** Hauling: carrying faces where he goes; dragging walks backwards, facing the block. */
export function haulGait(
  dx: number,
  dy: number,
  grip: Grip,
  pace: Pace = "trot",
) {
  return {
    pose: grip,
    flip: grip === "drag" ? dx > 0 : dx < 0,
    duration: travelTime(
      Math.hypot(dx, dy),
      SPEED.run * PACE[pace] * LOAD[grip],
    ),
  };
}

function travelTime(distance: number, speed: number) {
  return Math.max(MIN_DURATION, Math.round((distance / speed) * 100) / 100);
}
