import type { Pace } from "./build-plan";
import type { ContentKind } from "./content-tree";

export type TravelPose = "run" | "run-down" | "run-up" | "fly";
export type Grip = "carry" | "push";

export type Gait = {
  pose: TravelPose;
  /** Facing left. */
  flip: boolean;
  /** Tilt in degrees, only when flying a diagonal. */
  rot: number;
  /** Seconds. */
  duration: number;
};

/* Pixels a second. Slow enough to follow on a big screen. */
const SPEED: Record<TravelPose, number> = {
  run: 340,
  "run-down": 270,
  "run-up": 270,
  fly: 440,
};
const PACE: Record<Pace, number> = { stroll: 0.75, trot: 1, dash: 1.3 };
/** Hauling a block slows him down; pushing a big one slows him more. */
const LOAD: Record<Grip, number> = { carry: 0.8, push: 0.6 };
const MIN_DURATION = 0.55;
const MAX_DURATION = 2.8;

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

/** Small pieces go overhead; whole cards and jobs get pushed. */
export function gripFor(kind: ContentKind): Grip {
  return kind === "figure" || kind === "quote" ? "carry" : "push";
}

/** Hauling: he faces where he goes, the block overhead or in front of his paws. */
export function haulGait(
  dx: number,
  dy: number,
  grip: Grip,
  pace: Pace = "trot",
) {
  return {
    pose: grip,
    flip: dx < 0,
    duration: travelTime(
      Math.hypot(dx, dy),
      SPEED.run * PACE[pace] * LOAD[grip],
    ),
  };
}

function travelTime(distance: number, speed: number) {
  const seconds = Math.round((distance / speed) * 100) / 100;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, seconds));
}

type Size = { w: number; h: number };

/**
 * Where a hauled block sits relative to Ledger's top-left corner, so it moves
 * with him: resting on his raised paws when carried, against his outstretched
 * paws on the side he faces when pushed. Fractions follow the 240×250 artwork.
 */
export function holdOffset(
  grip: Grip,
  flip: boolean,
  cat: Size,
  block: Size,
): { x: number; y: number } {
  if (grip === "carry") {
    return { x: cat.w / 2 - block.w / 2, y: cat.h * 0.34 - block.h };
  }
  const y = cat.h * 0.64 - Math.min(block.h, cat.h * 1.2) / 2;
  return flip ? { x: cat.w * 0.14 - block.w, y } : { x: cat.w * 0.86, y };
}
