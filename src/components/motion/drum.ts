import type { MotionValue } from "motion/react";
import type { CSSProperties } from "react";

/**
 * A Rolodex's position (0 to `count - 1`) for a chapter progress. It dwells
 * on each card and flips quickly between them, like a Rolodex clicking over.
 * `turn` is the part of the chapter the drum turns over.
 */
export function drumPosition(
  progress: number,
  count: number,
  turn: readonly [number, number],
): number {
  if (count <= 1) return 0;
  const t = Math.min(
    1,
    Math.max(0, (progress - turn[0]) / (turn[1] - turn[0])),
  );
  const x = t * (count - 1);
  const card = Math.min(count - 2, Math.floor(x));
  const r = x - card;
  // Smootherstep: flat at both ends, so each card holds before the next flips.
  return card + r * r * r * (r * (r * 6 - 15) + 10);
}

/**
 * The style that places one piece of a drum: the drum's position and the
 * piece's own index. Given to each card (and to anything inside it that reads
 * them) directly, because `--d` is registered as not inherited (motion.css):
 * otherwise every frame would re-style everything inside every card.
 */
export function at(
  position: MotionValue<number>,
  index: number,
): CSSProperties {
  return { "--d": position, "--i": index } as unknown as CSSProperties;
}
