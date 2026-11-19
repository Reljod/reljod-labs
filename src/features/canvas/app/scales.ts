import type { TimeUnit } from "./format";

/** Scales, ticks and stacking for the App's charts. Pure. */

export type Scale = {
  (value: number): number;
  invert: (pixel: number) => number;
  domain: [number, number];
  range: [number, number];
};

export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) =>
    r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  scale.invert = (pixel) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  scale.domain = [d0, d0 + span];
  scale.range = range;
  return scale;
}

const STEPS = [1, 2, 2.5, 5, 10];

/**
 * Round ticks covering [min, max]: steps of 1, 2, 2.5 or 5 times a power of
 * ten, about `count` of them and never more than `count + 2`.
 */
export function niceTicks(min: number, max: number, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min = min >= 0 && min - pad < 0 ? 0 : min - pad / 2;
    max += pad / 2;
  }
  const rough = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step =
    (STEPS.find((candidate) => candidate * power >= rough - 1e-12) ?? 10) *
    power;
  const first = Math.floor(min / step + 1e-9) * step;
  const last = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let index = 0; first + index * step <= last + step / 2; index++)
    ticks.push(Number((first + index * step).toFixed(decimals)));
  return { ticks, min: ticks[0], max: ticks[ticks.length - 1], step };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Interval = { unit: TimeUnit; every: number; ms: number };
const INTERVALS: Interval[] = [
  { unit: "hour", every: 1, ms: HOUR },
  { unit: "hour", every: 3, ms: 3 * HOUR },
  { unit: "hour", every: 6, ms: 6 * HOUR },
  { unit: "hour", every: 12, ms: 12 * HOUR },
  { unit: "day", every: 1, ms: DAY },
  { unit: "day", every: 2, ms: 2 * DAY },
  { unit: "day", every: 7, ms: 7 * DAY },
  { unit: "day", every: 14, ms: 14 * DAY },
  { unit: "month", every: 1, ms: 30.44 * DAY },
  { unit: "month", every: 2, ms: 61 * DAY },
  { unit: "month", every: 3, ms: 91.3 * DAY },
  { unit: "month", every: 6, ms: 182.6 * DAY },
  { unit: "year", every: 1, ms: 365.25 * DAY },
  { unit: "year", every: 2, ms: 730.5 * DAY },
  { unit: "year", every: 5, ms: 1826 * DAY },
  { unit: "year", every: 10, ms: 3652 * DAY },
  { unit: "year", every: 25, ms: 9131 * DAY },
  { unit: "year", every: 100, ms: 36525 * DAY },
];

/**
 * Calendar ticks inside [min, max]: whole hours, days, months or years, at
 * most `maxCount` of them. Days land on midnight, months on the 1st.
 */
export function timeTicks(
  min: number,
  max: number,
  maxCount = 6,
): { ticks: number[]; unit: TimeUnit } {
  if (!(max > min)) return { ticks: [min], unit: "day" };
  const span = max - min;
  const interval =
    INTERVALS.find((item) => span / item.ms <= Math.max(1, maxCount)) ??
    INTERVALS[INTERVALS.length - 1];
  const ticks: number[] = [];
  const start = new Date(min);
  const { unit, every } = interval;
  if (unit === "hour" || unit === "day") {
    const size = interval.ms;
    // Days count from the epoch's Monday-aligned midnight so weekly ticks are stable.
    const origin = unit === "day" && every >= 7 ? 4 * DAY : 0;
    let tick = Math.ceil((min - origin) / size) * size + origin;
    for (; tick <= max; tick += size) ticks.push(tick);
  } else if (unit === "month") {
    let year = start.getUTCFullYear();
    let month = Math.ceil(start.getUTCMonth() / every) * every;
    for (;;) {
      const tick = Date.UTC(year, month, 1);
      if (tick > max) break;
      if (tick >= min) ticks.push(tick);
      month += every;
      if (month >= 12) {
        year += Math.floor(month / 12);
        month %= 12;
      }
    }
  } else {
    let year = Math.ceil(start.getUTCFullYear() / every) * every;
    for (;;) {
      const tick = Date.UTC(year, 0, 1);
      if (tick > max) break;
      if (tick >= min) ticks.push(tick);
      year += every;
    }
  }
  if (ticks.length === 0) ticks.push(min);
  return { ticks, unit };
}

export type Band = {
  /** Distance from one band's start to the next. */
  step: number;
  /** Width of the band itself. */
  width: number;
  start: (index: number) => number;
  center: (index: number) => number;
  /** The band a pixel falls in, clamped to the ends. */
  indexAt: (pixel: number) => number;
};

export function bandScale(
  count: number,
  range: [number, number],
  padding = 0.2,
): Band {
  const [r0, r1] = range;
  const step = (r1 - r0) / Math.max(1, count);
  const width = step * (1 - padding);
  const start = (index: number) => r0 + index * step + (step - width) / 2;
  return {
    step,
    width,
    start,
    center: (index) => r0 + index * step + step / 2,
    indexAt: (pixel) =>
      Math.max(0, Math.min(count - 1, Math.floor((pixel - r0) / (step || 1)))),
  };
}

/**
 * Stacks series on top of one another, per x. Positive values pile up from
 * zero, negative ones pile down, so a mixed column still reads from the baseline.
 * `values[series][x]`; the answer has the same shape, each cell `[from, to]`.
 */
export function stack(values: (number | null)[][]): [number, number][][] {
  const length = Math.max(0, ...values.map((series) => series.length));
  const up = new Array<number>(length).fill(0);
  const down = new Array<number>(length).fill(0);
  return values.map((series) =>
    Array.from({ length }, (_, index): [number, number] => {
      const value = series[index] ?? 0;
      if (value >= 0) {
        const from = up[index];
        up[index] = from + value;
        return [from, up[index]];
      }
      const from = down[index];
      down[index] = from + value;
      return [from, down[index]];
    }),
  );
}

/**
 * Which of `count` evenly spaced labels to keep so they do not touch: every
 * k-th, always including the first. Nothing is rotated; ticks are dropped.
 */
export function thinEvery(
  count: number,
  labelWidth: number,
  available: number,
) {
  if (count <= 1) return 1;
  const fit = Math.max(1, Math.floor(available / Math.max(1, labelWidth)));
  return Math.max(1, Math.ceil(count / fit));
}

/** Rough width of a label in pixels at a font size (Inter and Plex Mono run close to this). */
export function textWidth(text: string, size = 11, mono = false) {
  return text.length * size * (mono ? 0.62 : 0.56);
}

/** The index of the sorted value closest to `target`. */
export function nearestIndex(sorted: number[], target: number) {
  if (sorted.length === 0) return -1;
  let low = 0;
  let high = sorted.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < target) low = middle;
    else high = middle;
  }
  return Math.abs(sorted[low] - target) <= Math.abs(sorted[high] - target)
    ? low
    : high;
}

/** Splits [min, max] into `classes` equal steps and says which one a value is in. */
export function quantize(value: number, min: number, max: number, classes = 7) {
  if (!(max > min)) return Math.floor(classes / 2);
  const at = Math.floor(((value - min) / (max - min)) * classes);
  return Math.max(0, Math.min(classes - 1, at));
}
