/**
 * Air quality at twelve stations, hourly: NO2 follows traffic and is blown
 * away by wind, PM2.5 adds winter heating and is washed out by rain, ozone
 * follows sunshine and heat. The heatwave's stagnant air makes all of it worse.
 */
import { HOURS, hourString, isRestDay, winterness } from "./calendar";
import { AIR_STATIONS, REGION_INDEX } from "./geography";
import { rngFor, round } from "./prng";
import type { Cell } from "./types";
import { heatwaveDay, weather } from "./weather";

const WORKDAY_TRAFFIC = [
  0.15, 0.1, 0.08, 0.08, 0.12, 0.3, 0.7, 1.15, 1.3, 0.95, 0.75, 0.72, 0.75,
  0.74, 0.76, 0.88, 1.08, 1.28, 1.15, 0.8, 0.55, 0.42, 0.32, 0.22,
];
const RESTDAY_TRAFFIC = [
  0.22, 0.16, 0.12, 0.1, 0.1, 0.14, 0.24, 0.38, 0.55, 0.7, 0.8, 0.85, 0.86,
  0.85, 0.82, 0.8, 0.78, 0.74, 0.66, 0.55, 0.45, 0.38, 0.3, 0.24,
];
/** Evening home heating, by hour. */
const HEATING = [
  0.6, 0.45, 0.35, 0.3, 0.3, 0.4, 0.65, 0.75, 0.5, 0.3, 0.2, 0.15, 0.12, 0.12,
  0.15, 0.2, 0.35, 0.65, 0.95, 1, 0.95, 0.9, 0.8, 0.7,
];

export function* airQualityRows(): Generator<Cell[]> {
  const w = weather();
  const rng = rngFor("air_quality");
  const regionOf = AIR_STATIONS.map((s) => REGION_INDEX[s.regionCode]);
  for (let h = 0; h < HOURS; h++) {
    const d = Math.floor(h / 24);
    const hr = h % 24;
    const traffic = (isRestDay(d) ? RESTDAY_TRAFFIC : WORKDAY_TRAFFIC)[hr];
    const ts = hourString(h);
    const winter = winterness(d);
    for (let s = 0; s < AIR_STATIONS.length; s++) {
      const station = AIR_STATIONS[s];
      const i = regionOf[s] * HOURS + h;
      const wind = w.wind[i];
      const t = w.temperature[i];
      const heat = heatwaveDay(station.regionCode, d);
      const dispersal = 0.55 + wind / 4;
      const no2 = Math.max(
        0.5,
        5 +
          (38 * station.traffic * traffic * (1 + 0.15 * winter)) / dispersal +
          2 * rng.normal(),
      );
      const settingHeat =
        station.setting === "rural"
          ? 1.2
          : station.setting === "coastal"
            ? 0.6
            : 1;
      let pm25 =
        (4 +
          9 * station.traffic * traffic +
          9 * winter * HEATING[hr] * settingHeat) /
          (0.5 + wind / 6) +
        1.1 * rng.normal();
      if (w.rain[i] > 0.4) pm25 *= 0.6;
      if (heat) pm25 += 8 + 3 * rng.next();
      const o3 =
        14 +
        0.055 * w.solar[i] +
        1.6 * Math.max(0, t - 18) -
        0.25 * no2 +
        3 * rng.normal();
      yield [
        ts,
        station.id,
        station.regionCode,
        round(Math.max(1, pm25), 1),
        round(no2, 1),
        round(Math.max(1, o3), 1),
      ];
    }
  }
}

export const AIR_QUALITY_ROWS = HOURS * AIR_STATIONS.length;
