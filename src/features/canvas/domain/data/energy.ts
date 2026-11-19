/**
 * Electricity: hourly load by region (cached, generation depends on it) and
 * hourly generation by region and source, dispatched so that national
 * generation equals national load plus 4-6% network losses.
 */
import {
  DAYS,
  HOURS,
  hourString,
  isHoliday,
  isRestDay,
  winterness,
} from "./calendar";
import {
  CAPACITY_MW,
  REGION_SOURCES,
  REGIONS,
  SOURCES,
  type Source,
} from "./geography";
import { clamp, rngFor, round } from "./prng";
import type { Cell } from "./types";
import { heatwaveDay, weather } from "./weather";

/** Average demand per person, MW. */
const MW_PER_PERSON = 0.00082;

// Hour-of-day shape of demand, working day and rest day.
const WORKDAY_SHAPE = [
  0.72, 0.68, 0.66, 0.65, 0.67, 0.74, 0.88, 1.02, 1.08, 1.07, 1.06, 1.05, 1.04,
  1.04, 1.03, 1.04, 1.08, 1.17, 1.22, 1.18, 1.08, 0.97, 0.86, 0.78,
];
const RESTDAY_SHAPE = [
  0.74, 0.7, 0.67, 0.66, 0.66, 0.68, 0.74, 0.82, 0.9, 0.96, 0.99, 1, 1, 0.99,
  0.97, 0.97, 1.0, 1.08, 1.14, 1.11, 1.03, 0.94, 0.85, 0.79,
];

export type Load = {
  /** [region * HOURS + hour], MW, rounded to 0.1. */
  byRegion: Float64Array;
  /** National load per hour, MW. */
  national: Float64Array;
};

let cachedLoad: Load | null = null;

export function load(): Load {
  if (cachedLoad) return cachedLoad;
  const w = weather();
  const rng = rngFor("grid_load");
  const byRegion = new Float64Array(REGIONS.length * HOURS);
  const national = new Float64Array(HOURS);
  REGIONS.forEach((region, r) => {
    const base = region.population * MW_PER_PERSON;
    let noise = 0;
    for (let h = 0; h < HOURS; h++) {
      const d = Math.floor(h / 24);
      const hr = h % 24;
      const rest = isRestDay(d);
      const shape =
        (rest ? RESTDAY_SHAPE : WORKDAY_SHAPE)[hr] * (isHoliday(d) ? 0.94 : 1);
      const t = w.temperature[r * HOURS + h];
      // Air conditioning works harder the hotter it gets.
      const cooling = 0.03 * Math.max(0, t - 22) + 0.025 * Math.max(0, t - 32);
      const heating = 0.016 * Math.max(0, 13 - t);
      noise = 0.9 * noise + 0.006 * rng.normal();
      const value =
        base *
        shape *
        (1 + 0.05 * winterness(d)) *
        (1 + cooling + heating) *
        (1 + noise);
      byRegion[r * HOURS + h] = round(value, 1);
      national[h] += byRegion[r * HOURS + h];
    }
  });
  cachedLoad = { byRegion, national };
  return cachedLoad;
}

export function* gridLoadRows(): Generator<Cell[]> {
  const { byRegion } = load();
  for (let h = 0; h < HOURS; h++) {
    const ts = hourString(h);
    for (let r = 0; r < REGIONS.length; r++) {
      yield [ts, REGIONS[r].code, byRegion[r * HOURS + h]];
    }
  }
}

/** Network losses as a share of load: 4.3% at the lightest hour, 5.7% at the peak. */
export function lossShare(nationalLoad: number, peak: number): number {
  return 0.043 + 0.014 * (nationalLoad / peak);
}

/** Wind turbine output share for a hub wind speed, m/s. */
function windCurve(ms: number): number {
  if (ms < 3 || ms > 25) return 0;
  if (ms >= 12.5) return 1;
  return ((ms - 3) / 9.5) ** 3;
}

/** Hydro availability per region and day: wetter months and recent rain fill the lakes. */
function hydroAvailability(): Float64Array {
  const w = weather();
  const out = new Float64Array(REGIONS.length * DAYS);
  REGIONS.forEach((region, r) => {
    let reservoir = 4;
    for (let d = 0; d < DAYS; d++) {
      reservoir = 0.96 * reservoir + 0.04 * w.dailyRain[r * DAYS + d];
      const base = clamp(
        0.24 + 0.22 * winterness(d) + 0.035 * reservoir,
        0.15,
        0.85,
      );
      out[r * DAYS + d] = base * (heatwaveDay(region.code, d) ? 0.6 : 1);
    }
  });
  return out;
}

const GAS_TOTAL = REGIONS.reduce(
  (s, r) => s + (CAPACITY_MW[r.code].gas ?? 0),
  0,
);
const IMPORT_TOTAL = REGIONS.reduce(
  (s, r) => s + (CAPACITY_MW[r.code].imports ?? 0),
  0,
);

/**
 * Generation by region and source for one hour, MW (unrounded), in
 * REGION_SOURCES order. `importsDraw` (0..1 per region) varies the imports.
 */
function dispatchHour(
  h: number,
  required: number,
  hydroAvail: Float64Array,
  importsDraw: readonly number[],
): Record<Source, number>[] {
  const w = weather();
  const d = Math.floor(h / 24);
  const hr = h % 24;
  const peaking = 0.7 + (0.45 * (WORKDAY_SHAPE[hr] - 0.65)) / 0.57;
  const out = REGIONS.map((region, r) => {
    const cap = CAPACITY_MW[region.code];
    const i = r * HOURS + h;
    return {
      hydro: (cap.hydro ?? 0) * hydroAvail[r * DAYS + d] * peaking,
      wind: (cap.wind ?? 0) * windCurve(w.wind[i] * 1.25),
      solar: ((cap.solar ?? 0) * w.solar[i] * 0.88) / 1000,
      gas: 0,
      coal: (cap.coal ?? 0) * (0.76 + 0.05 * Math.sin((2 * Math.PI * d) / 23)),
      imports: (cap.imports ?? 0) * (0.2 + 0.25 * importsDraw[r]),
    };
  });
  const sum = (key: Source) => out.reduce((s, g) => s + g[key], 0);
  const mustRun = SOURCES.filter((s) => s !== "gas").reduce(
    (s, key) => s + sum(key),
    0,
  );
  const gasMin = 0.1 * GAS_TOTAL;
  let gas = required - mustRun;
  if (gas < gasMin) {
    // Too much must-run: curtail imports, then wind and solar, then coal.
    let excess = gasMin - gas;
    for (const keys of [
      ["imports"],
      ["wind", "solar"],
      ["coal"],
      ["hydro"],
    ] as Source[][]) {
      const available = keys.reduce(
        (s, k) => s + sum(k) * (k === "coal" ? 0.5 : 0.95),
        0,
      );
      if (available <= 0) continue;
      const cut = Math.min(excess, available);
      const total = keys.reduce((s, k) => s + sum(k), 0);
      for (const g of out) for (const k of keys) g[k] -= (g[k] / total) * cut;
      excess -= cut;
      if (excess <= 1e-9) break;
    }
    gas = gasMin;
  } else if (gas > 0.96 * GAS_TOTAL) {
    // Gas is flat out: import the rest.
    const extra = gas - 0.96 * GAS_TOTAL;
    REGIONS.forEach((region, r) => {
      out[r].imports +=
        (extra * (CAPACITY_MW[region.code].imports ?? 0)) / IMPORT_TOTAL;
    });
    gas = 0.96 * GAS_TOTAL;
  }
  REGIONS.forEach((region, r) => {
    out[r].gas = (gas * (CAPACITY_MW[region.code].gas ?? 0)) / GAS_TOTAL;
  });
  return out;
}

export function* gridGenerationRows(): Generator<Cell[]> {
  const { national } = load();
  let peak = 0;
  for (let h = 0; h < HOURS; h++) peak = Math.max(peak, national[h]);
  const hydroAvail = hydroAvailability();
  const rng = rngFor("grid_generation");
  const draws = REGIONS.map(() => 0.5);
  for (let h = 0; h < HOURS; h++) {
    for (let r = 0; r < draws.length; r++) {
      draws[r] = clamp(
        0.85 * draws[r] + 0.15 * rng.next() + 0.05 * rng.normal(),
        0,
        1,
      );
    }
    const required = national[h] * (1 + lossShare(national[h], peak));
    const generation = dispatchHour(h, required, hydroAvail, draws);
    const ts = hourString(h);
    for (let r = 0; r < REGIONS.length; r++) {
      for (const source of REGION_SOURCES[r]) {
        yield [ts, REGIONS[r].code, source, round(generation[r][source], 1)];
      }
    }
  }
}

export const GRID_GENERATION_ROWS =
  HOURS * REGION_SOURCES.reduce((s, list) => s + list.length, 0);
