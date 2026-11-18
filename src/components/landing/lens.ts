/** A circle and a box, in the same pixel space (the lens game's stage). */
export type Circle = { x: number; y: number; r: number };
export type Box = { left: number; top: number; width: number; height: number };

/** True when the circle touches the box: the lens is over that spot. */
export function lensTouches(lens: Circle, box: Box): boolean {
  const nearestX = Math.max(box.left, Math.min(lens.x, box.left + box.width));
  const nearestY = Math.max(box.top, Math.min(lens.y, box.top + box.height));
  const dx = lens.x - nearestX;
  const dy = lens.y - nearestY;
  return dx * dx + dy * dy <= lens.r * lens.r;
}

/** Keeps a fraction of the stage (0..1) inside it, so the lens can't be dragged off. */
export function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
