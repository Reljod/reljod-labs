/**
 * Ferry and rail ridership per route and service hour. Commuter peaks on
 * working days, summer crowds on the ferries, weather cancellations, the ferry
 * strike, the storm and the new Saltmere Crosslink all show here.
 */
import {
  DAYS,
  dateString,
  dayIndex,
  HOURS,
  inRange,
  isHoliday,
  isRestDay,
  summerness,
  weekday,
} from "./calendar";
import { REGION_INDEX, ROUTES, type Route, SERVICE_HOURS } from "./geography";
import { clamp, rngFor } from "./prng";
import { STORY } from "./story";
import type { Cell } from "./types";
import { stormStrength, weather } from "./weather";

const WORKDAY_PROFILE: Record<number, number> = {
  5: 0.25,
  6: 0.55,
  7: 1.25,
  8: 1.55,
  9: 0.95,
  10: 0.6,
  11: 0.55,
  12: 0.62,
  13: 0.6,
  14: 0.6,
  15: 0.75,
  16: 1.15,
  17: 1.5,
  18: 1.05,
  19: 0.62,
  20: 0.45,
  21: 0.35,
  22: 0.25,
  23: 0.15,
};
const RESTDAY_PROFILE: Record<number, number> = {
  5: 0.15,
  6: 0.25,
  7: 0.4,
  8: 0.6,
  9: 0.85,
  10: 1.05,
  11: 1.15,
  12: 1.2,
  13: 1.2,
  14: 1.15,
  15: 1.1,
  16: 1.0,
  17: 0.9,
  18: 0.75,
  19: 0.6,
  20: 0.45,
  21: 0.35,
  22: 0.25,
  23: 0.18,
};

function profileShare(
  profile: Record<number, number>,
  mode: Route["mode"],
): Record<number, number> {
  const [from, to] = SERVICE_HOURS[mode];
  let total = 0;
  for (let h = from; h <= to; h++) total += profile[h];
  const out: Record<number, number> = {};
  for (let h = from; h <= to; h++) out[h] = profile[h] / total;
  return out;
}

const SHARES = {
  ferry: {
    work: profileShare(WORKDAY_PROFILE, "ferry"),
    rest: profileShare(RESTDAY_PROFILE, "ferry"),
  },
  rail: {
    work: profileShare(WORKDAY_PROFILE, "rail"),
    rest: profileShare(RESTDAY_PROFILE, "rail"),
  },
};

/** Services per hour: peaks, shoulders, off-peak and late evening. */
function servicesPerHour(
  mode: Route["mode"],
  hour: number,
  rest: boolean,
): number {
  const peak =
    !rest && ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18));
  const late = hour >= 21 || hour <= 5;
  if (mode === "rail") return peak ? 6 : late ? 2 : rest ? 3 : 4;
  return peak ? 3 : late ? 1 : 2;
}

const OPEN_DAY = new Map(
  ROUTES.map((r) => [
    r.id,
    r.opened.startsWith("2025") ? dayIndex(r.opened) : 0,
  ]),
);

/** Rows in `ridership`: every route, every service hour of every day it was open. */
export const RIDERSHIP_ROWS = ROUTES.reduce((sum, route) => {
  const [from, to] = SERVICE_HOURS[route.mode];
  return sum + (to - from + 1) * (DAYS - (OPEN_DAY.get(route.id) ?? 0));
}, 0);

const PARALLEL = new Map(
  STORY.ferryStrike.parallelRail.map((p) => [p.railRouteId, p.ferryRouteId]),
);
const NEW_RAIL_DAY = dayIndex(STORY.newRail.opened);

/** The day factor of a route: weekday, holiday and season. */
function dayFactor(route: Route, d: number): number {
  const wd = weekday(d);
  let f = 1;
  if (isHoliday(d)) f = 0.5;
  else if (wd === 6) f = route.mode === "ferry" ? 0.85 : 0.6;
  else if (wd === 0) f = route.mode === "ferry" ? 0.75 : 0.5;
  else if (wd === 5) f = 1.05;
  const summer = summerness(d);
  if (route.mode === "ferry") {
    f *= 1 + 0.18 * summer + (isRestDay(d) ? 0.2 * Math.max(0, summer) : 0);
  } else {
    // School holidays thin the January trains.
    f *= 1 - 0.06 * Math.max(0, summer);
  }
  return f;
}

export function* ridershipRows(): Generator<Cell[]> {
  const w = weather();
  const rng = rngFor("ridership");
  for (let d = 0; d < DAYS; d++) {
    const date = dateString(d);
    const rest = isRestDay(d);
    const strike = inRange(d, STORY.ferryStrike.start, STORY.ferryStrike.end);
    const sinceNewRail = d - NEW_RAIL_DAY + 1;
    const newRailRamp =
      sinceNewRail <= 0
        ? 0
        : clamp(sinceNewRail / STORY.newRail.rampDays, 0, 1);
    // One draw per route per day: a busy or quiet day for that route.
    const routeDay = ROUTES.map(() => 1 + 0.04 * rng.normal());
    const strikeDay = ROUTES.map(() => 1 + 0.012 * rng.normal());
    for (let hour = 5; hour <= 23; hour++) {
      for (let k = 0; k < ROUTES.length; k++) {
        const route = ROUTES[k];
        const [from, to] = SERVICE_HOURS[route.mode];
        if (hour < from || hour > to || d < (OPEN_DAY.get(route.id) ?? 0))
          continue;
        const r = REGION_INDEX[route.regionCode];
        const h = d * 24 + hour;
        const share = SHARES[route.mode][rest ? "rest" : "work"][hour];
        // On strike days the parallel lines are full of ferry riders: the
        // strike, not the usual day-to-day swing, sets their level.
        const parallelStrike = strike && PARALLEL.has(route.id);
        let daily =
          route.dailyBoardings *
          dayFactor(route, d) *
          (parallelStrike ? 1.35 * strikeDay[k] : routeDay[k]);
        if (route.mode === "ferry") {
          daily *= clamp(1 - 0.012 * w.dailyRain[r * DAYS + d], 0.7, 1);
          if (route.id === STORY.newRail.fromFerryRouteId)
            daily *= 1 - 0.36 * newRailRamp;
        }
        if (route.id === STORY.newRail.routeId)
          daily *= 0.35 + 0.65 * newRailRamp;
        const capacity =
          servicesPerHour(route.mode, hour, rest) * route.vehicleCapacity;
        let cancelled = false;
        if (route.mode === "ferry") {
          const wind = w.wind[r * HOURS + h];
          const stormHit =
            STORY.storm.regions.includes(route.regionCode) &&
            stormStrength(h) > 0.3;
          cancelled =
            strike ||
            stormHit ||
            wind > 18.5 ||
            rng.chance(wind > 14 ? 0.05 : 0.003);
        } else {
          cancelled = rng.chance(0.002);
        }
        const expected = daily * share * (1 + 0.08 * rng.normal());
        const boardings = cancelled
          ? 0
          : Math.round(
              clamp(expected, 0, capacity * (route.mode === "rail" ? 1.4 : 1)),
            );
        yield [
          date,
          hour,
          route.id,
          route.mode,
          boardings,
          capacity,
          cancelled,
        ];
      }
    }
  }
}
