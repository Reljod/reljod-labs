/**
 * Harbour calls at Meridia's five commercial ports. How many vessels arrive
 * each day is planned first (cheaply, so the row count is known up front);
 * the times and cargo of each call are drawn when the table is read.
 */
import {
  DAYS,
  inRange,
  minutesOf,
  summerness,
  timestampAt,
  weekday,
} from "./calendar";
import { PORTS, VESSEL_TYPES, type VesselType } from "./geography";
import { rngFor, round } from "./prng";
import { STORY } from "./story";
import type { Cell } from "./types";

type Plan = {
  /** [(day * PORTS + port) * TYPES + type]: arrivals. */
  counts: Uint16Array;
  /** Same index: how many of those arrivals are backlog from the closure. */
  backlog: Uint16Array;
  total: number;
};

const TYPES = VESSEL_TYPES.length;
const STORM_PORT = PORTS.findIndex((p) => p.name === STORY.storm.port);
const CLOSED_FROM = minutesOf(STORY.storm.closedFrom);
const CLOSED_UNTIL = minutesOf(STORY.storm.closedUntil);
const CLOSED_FIRST_DAY = Math.floor(CLOSED_FROM / 1440);
const CLOSED_LAST_DAY = Math.floor((CLOSED_UNTIL - 1) / 1440);

function seasonal(type: VesselType, port: number, d: number): number {
  const wd = weekday(d);
  const summer = summerness(d);
  switch (type) {
    case "cruise":
      return Math.max(0.05, 1 + 1.6 * summer);
    case "ferry":
      return (wd === 0 ? 0.8 : 1) * (1 + 0.12 * summer);
    case "fishing":
      return (wd === 0 ? 0.4 : 1) * (1 - 0.15 * summer * (port % 2 ? 1 : -1));
    default:
      return wd === 0 ? 0.75 : 1;
  }
}

let cachedPlan: Plan | null = null;

export function harbourPlan(): Plan {
  if (cachedPlan) return cachedPlan;
  const rng = rngFor("harbour_calls:plan");
  const size = DAYS * PORTS.length * TYPES;
  const counts = new Uint16Array(size);
  const backlog = new Uint16Array(size);
  const strikeFerries = (d: number) =>
    inRange(d, STORY.ferryStrike.start, STORY.ferryStrike.end);
  const stormDay = (d: number) =>
    inRange(d, STORY.storm.start, STORY.storm.end);
  const stormPorts = new Set(
    PORTS.map((p, i) => (STORY.storm.regions.includes(p.regionCode) ? i : -1)),
  );
  const missed = new Uint16Array(TYPES);
  for (let d = 0; d < DAYS; d++) {
    for (let p = 0; p < PORTS.length; p++) {
      for (let t = 0; t < TYPES; t++) {
        const type = VESSEL_TYPES[t];
        let n = rng.poisson(
          PORTS[p].dailyArrivals[type] * seasonal(type, p, d),
        );
        if (type === "ferry" && strikeFerries(d)) n = 0;
        if (stormDay(d) && stormPorts.has(p) && p !== STORM_PORT) {
          if (type === "ferry") n = 0;
          else n = Math.floor(n / 2);
        }
        if (p === STORM_PORT && d >= CLOSED_FIRST_DAY && d <= CLOSED_LAST_DAY) {
          if (type !== "ferry" && type !== "fishing") missed[t] += n;
          n = 0;
        }
        counts[(d * PORTS.length + p) * TYPES + t] = n;
      }
    }
  }
  // The vessels that could not arrive come in over the backlog days.
  for (let t = 0; t < TYPES; t++) {
    let left = missed[t];
    for (let k = 0; k < STORY.storm.backlogDays && left > 0; k++) {
      const d = CLOSED_LAST_DAY + 1 + k;
      const share =
        k === STORY.storm.backlogDays - 1 ? left : Math.ceil(left * 0.5);
      const i = (d * PORTS.length + STORM_PORT) * TYPES + t;
      counts[i] += share;
      backlog[i] += share;
      left -= share;
    }
  }
  let total = 0;
  for (const n of counts) total += n;
  cachedPlan = { counts, backlog, total };
  return cachedPlan;
}

type Call = {
  port: number;
  type: VesselType;
  arrival: number;
  departure: number;
  cargo: number;
  teu: number | null;
};

const BERTH_HOURS: Record<VesselType, [number, number]> = {
  container: [14, 30],
  bulk: [30, 72],
  tanker: [20, 40],
  ferry: [0.5, 1.5],
  fishing: [4, 12],
  cruise: [8, 12],
};

export function* harbourCallRows(): Generator<Cell[]> {
  const plan = harbourPlan();
  const rng = rngFor("harbour_calls");
  let serial = 0;
  for (let d = 0; d < DAYS; d++) {
    const calls: Call[] = [];
    for (let p = 0; p < PORTS.length; p++) {
      for (let t = 0; t < TYPES; t++) {
        const type = VESSEL_TYPES[t];
        const i = (d * PORTS.length + p) * TYPES + t;
        const n = plan.counts[i];
        for (let k = 0; k < n; k++) {
          const isBacklog = k < plan.backlog[i];
          const minuteOfDay =
            type === "ferry"
              ? rng.int(6 * 60, 22 * 60)
              : type === "cruise"
                ? rng.int(5 * 60, 9 * 60)
                : isBacklog
                  ? Math.floor(1440 * rng.next() ** 2)
                  : rng.int(0, 1439);
          const arrival = d * 1440 + minuteOfDay;
          const [lo, hi] = BERTH_HOURS[type];
          let departure = arrival + Math.round(rng.range(lo, hi) * 60);
          if (isBacklog) departure += Math.round(rng.range(4, 14) * 60);
          // Vessels in port when it closes wait until it opens again.
          if (
            p === STORM_PORT &&
            arrival < CLOSED_FROM &&
            departure > CLOSED_FROM
          ) {
            departure = Math.max(
              departure,
              CLOSED_UNTIL + Math.round(rng.range(1, 10) * 60),
            );
          }
          let cargo = 0;
          let teu: number | null = null;
          if (type === "container") {
            teu = rng.int(300, 4500);
            cargo = Math.round(teu * rng.range(9, 13));
          } else if (type === "bulk") cargo = rng.int(18_000, 62_000);
          else if (type === "tanker") cargo = rng.int(12_000, 80_000);
          else if (type === "ferry") cargo = rng.int(150, 1500);
          else if (type === "fishing") cargo = rng.int(4, 65);
          calls.push({ port: p, type, arrival, departure, cargo, teu });
        }
      }
    }
    calls.sort((a, b) => a.arrival - b.arrival || a.port - b.port);
    for (const call of calls) {
      serial++;
      const port = PORTS[call.port];
      yield [
        `HC-${String(serial).padStart(6, "0")}`,
        port.name,
        port.regionCode,
        call.type,
        timestampAt(call.arrival),
        timestampAt(call.departure),
        round((call.departure - call.arrival) / 60, 1),
        call.cargo,
        call.teu,
      ];
    }
  }
}
