/*
 * Scroll-driven motion without a React render per frame: a chapter writes its
 * scroll progress (0 to 1) to the CSS variable `--p` once, and every piece
 * inside works out its own state from it with these CSS expressions.
 */

/** Rounds to keep generated CSS short and stable between server and client. */
const n = (value: number) => Number(value.toFixed(4));

/** 0 before `from`, 1 after `to`, linear between: a window of the chapter. */
export function seg(from: number, to: number, variable = "--p"): string {
  if (to <= from) throw new Error(`seg: empty window ${from}..${to}`);
  return `clamp(0, (var(${variable}) - ${n(from)}) / ${n(to - from)}, 1)`;
}

/** Ease-out (quadratic) of a 0..1 CSS expression. Each helper returns a `calc()`, valid on its own. */
export function easeOut(t: string): string {
  return `calc(1 - (1 - ${t}) * (1 - ${t}))`;
}

/** Ease-in-out (smoothstep) of a 0..1 CSS expression. */
export function smooth(t: string): string {
  return `calc(${t} * ${t} * (3 - 2 * ${t}))`;
}

/** A bump that rises and falls back over the window: 0 → 1 → 0. */
export function bump(t: string): string {
  return `calc(4 * ${t} * (1 - ${t}))`;
}

/** `from` at t = 0 to `to` at t = 1, in one CSS unit (`px`, `deg`, `cqw`…). */
export function mix(from: number, to: number, t: string, unit = ""): string {
  return `calc(${n(from)}${unit} + (${n(to - from)}${unit}) * ${t})`;
}

/**
 * Spreads `count` items' start times over 0..1 so each gets a window of
 * `width` and the last one finishes exactly at 1.
 */
export function stagger(count: number, width: number): number[] {
  if (count <= 1) return [0];
  const span = Math.max(0, 1 - width);
  return Array.from({ length: count }, (_, index) =>
    n((index / (count - 1)) * span),
  );
}

/** Maps a 0..1 window of a parent timeline onto `from`..`to` of the chapter. */
export function within(from: number, to: number, t: number): number {
  return n(from + (to - from) * t);
}

/** A figure such as "7 yrs" or "95–97%" split so its first number can count up. */
export function splitFigure(figure: string): {
  before: string;
  value: number;
  after: string;
} | null {
  const match = /(\d+(?:\.\d+)?)/.exec(figure);
  if (!match) return null;
  return {
    before: figure.slice(0, match.index),
    value: Number(match[1]),
    after: figure.slice(match.index + match[1].length),
  };
}
