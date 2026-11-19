/** The replay scrubber's arithmetic: which Frame shows, and for how long. Pure. */

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** A Frame index inside `0..count-1` (0 when there are no Frames). */
export function clampIndex(index: number, count: number) {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(index)));
}

export const stepIndex = (index: number, delta: number, count: number) =>
  clampIndex(index + delta, count);

/** The shortest and longest a Frame holds at 1x, whatever the recording says. */
export const DWELL = { min: 260, max: 1600, fallback: 600 } as const;

/**
 * How long Frame `index` stays up before the next one, when replaying: the
 * recorded gap to the next Frame, kept between a blink and a stall, divided
 * by the speed. Long model calls are not replayed in full.
 */
export function dwellMs(
  frames: readonly { at: number }[],
  index: number,
  speed: Speed,
) {
  const here = frames[index];
  const next = frames[index + 1];
  const gap = here && next ? next.at - here.at : DWELL.fallback;
  const held = Math.min(
    DWELL.max,
    Math.max(DWELL.min, Number.isFinite(gap) ? gap : DWELL.fallback),
  );
  return Math.round(held / speed);
}

/**
 * How long a Frame holds while following a live Run that is `behind` Frames
 * ahead of the screen: every Action is seen, and a burst is caught up fast.
 */
export function catchUpMs(behind: number) {
  if (behind <= 1) return 320;
  if (behind <= 4) return 200;
  return 90;
}

/** The scale that fits a `nativeWidth` picture into `width` pixels. */
export function fitScale(width: number, nativeWidth: number) {
  if (!(width > 0) || !(nativeWidth > 0)) return 0;
  return width / nativeWidth;
}
