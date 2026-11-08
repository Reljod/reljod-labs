import type { Pace } from "./build-plan";

export type TravelPose = "run" | "run-down" | "run-up" | "fly";

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
  run: 560,
  "run-down": 480,
  "run-up": 480,
  fly: 700,
};
const PACE: Record<Pace, number> = { stroll: 0.65, trot: 1, dash: 1.45 };
/** Pushing a block ahead of him slows him down. */
const LOADED = 0.7;
const MIN_DURATION = 0.45;

/**
 * Direction picks the view: under 25° from horizontal he gallops side-on,
 * over 60° he runs in top or bottom view, anything between he flies.
 */
export function chooseGait(
  dx: number,
  dy: number,
  pace: Pace = "trot",
  /** Pushing a block ahead of him. */
  loaded = false,
): Gait {
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
    duration: travelTime(
      distance,
      SPEED[pose] * PACE[pace] * (loaded ? LOADED : 1),
    ),
  };
}

function travelTime(distance: number, speed: number) {
  return Math.max(MIN_DURATION, Math.round((distance / speed) * 100) / 100);
}
