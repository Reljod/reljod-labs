/**
 * Hourly weather for every region in 2025, computed once and kept in module
 * scope: load, generation, air quality, ridership and the harbour all read it.
 * Values are stored already rounded, as they appear in the `weather` table, so
 * every table that depends on them agrees with what an analyst can see.
 */
import {
  DAYS,
  dayIndex,
  HOURS,
  inRange,
  minutesOf,
  summerness,
  winterness,
} from "./calendar";
import { REGIONS } from "./geography";
import { clamp, rngFor, round } from "./prng";
import { STORY } from "./story";

export type Weather = {
  /** Indexed [region * HOURS + hour]. */
  temperature: Float64Array;
  wind: Float64Array;
  rain: Float64Array;
  humidity: Float64Array;
  solar: Float64Array;
  /** Indexed [region * DAYS + day]: rain that day, mm. */
  dailyRain: Float64Array;
  /** Indexed [region * DAYS + day]: highest hourly wind that day, m/s. */
  dailyMaxWind: Float64Array;
};

/** Heatwave temperature anomaly by day of the event, °C (7 days). */
const HEAT_PROFILE = [8.3, 9.4, 10.4, 10.9, 10.6, 9.7, 8.4];

/** 0..1 strength of the heatwave on a day in a region. */
export function heatwaveDay(regionCode: string, day: number): number {
  const hw = STORY.heatwave;
  if (!hw.regions.includes(regionCode)) return 0;
  if (!inRange(day, hw.start, hw.end)) return 0;
  return 1;
}

function heatAnomaly(regionCode: string, day: number): number {
  if (!heatwaveDay(regionCode, day)) return 0;
  return HEAT_PROFILE[day - dayIndex(STORY.heatwave.start)] ?? 8;
}

const STORM_START_H = minutesOf(STORY.storm.closedFrom) / 60;
const STORM_END_H = minutesOf(STORY.storm.closedUntil) / 60;
const STORM_RAMP_H = 6;

/** 0..1 strength of the storm at an hour (ramps in and out over six hours). */
export function stormStrength(hour: number): number {
  if (hour < STORM_START_H - STORM_RAMP_H || hour >= STORM_END_H + STORM_RAMP_H)
    return 0;
  if (hour < STORM_START_H)
    return (hour - (STORM_START_H - STORM_RAMP_H)) / STORM_RAMP_H;
  if (hour >= STORM_END_H) return 1 - (hour - STORM_END_H + 1) / STORM_RAMP_H;
  return 1;
}

/** How hard the storm hits each storm region (the port's region first). */
const STORM_REACH = [1, 0.72, 0.66];

let cached: Weather | null = null;

export function weather(): Weather {
  if (cached) return cached;
  const rng = rngFor("weather");
  const n = REGIONS.length;
  const temperature = new Float64Array(n * HOURS);
  const wind = new Float64Array(n * HOURS);
  const rain = new Float64Array(n * HOURS);
  const humidity = new Float64Array(n * HOURS);
  const solar = new Float64Array(n * HOURS);
  const dailyRain = new Float64Array(n * DAYS);
  const dailyMaxWind = new Float64Array(n * DAYS);

  // National systems: a temperature anomaly, weather fronts and a wind anomaly.
  const nationalTemp = new Float64Array(DAYS + 1);
  const front = new Uint8Array(DAYS);
  const nationalWind = new Float64Array(DAYS);
  for (let d = 0; d <= DAYS; d++) {
    const prev = d > 0 ? nationalTemp[d - 1] : 0;
    nationalTemp[d] = clamp(0.8 * prev + 1.2 * rng.normal(), -5, 5);
  }
  for (let d = 0; d < DAYS; d++) {
    front[d] = rng.chance(0.2 + 0.2 * winterness(d)) ? 1 : 0;
    const prev = d > 0 ? nationalWind[d - 1] : 0;
    nationalWind[d] = clamp(0.6 * prev + 0.22 * rng.normal(), -0.6, 0.6);
  }
  const stormStartDay = dayIndex(STORY.storm.start);
  const stormEndDay = dayIndex(STORY.storm.end);

  for (let r = 0; r < n; r++) {
    const region = REGIONS[r];
    const stormReach = STORY.storm.regions.indexOf(region.code);
    const stormRainPerDay =
      stormReach < 0 ? 0 : rng.range(68, 84) * STORM_REACH[stormReach] ** 1.5;
    const stormPeak = rng.range(24.5, 27);
    // Regional anomaly, one value per day boundary for interpolation.
    const anomaly = new Float64Array(DAYS + 1);
    let regional = 0;
    for (let d = 0; d <= DAYS; d++) {
      regional = clamp(0.7 * regional + 0.8 * rng.normal(), -3, 3);
      anomaly[d] =
        nationalTemp[d] +
        regional +
        heatAnomaly(region.code, Math.min(d, DAYS - 1));
    }
    const seasonalAmp = region.coastal ? 5 : 7;
    const lat = (region.latitude * Math.PI) / 180;
    for (let d = 0; d < DAYS; d++) {
      const heat = heatwaveDay(region.code, d);
      const storm = d >= stormStartDay && d <= stormEndDay && stormReach >= 0;
      const wet = heat
        ? false
        : rng.chance(front[d] ? 0.72 : region.latitude < -38 ? 0.14 : 0.1);
      const rainTotal = wet
        ? -(5 + 4 * winterness(d)) * Math.log(Math.max(rng.next(), 1e-9))
        : 0;
      const rainDuration = rng.int(3, 12);
      const rainStart = rng.int(0, 24 - rainDuration);
      const cloud = heat ? 1 : wet ? rng.range(0.25, 0.5) : rng.range(0.68, 1);
      const diurnal =
        (region.coastal ? 3.2 : 5) * (wet ? 0.55 : 1) * (heat ? 1.25 : 1);
      const windLevel =
        (region.coastal ? 6.6 : 4.2) *
        (1 + 0.12 * winterness(d)) *
        Math.exp(0.28 * rng.normal() + nationalWind[d]) *
        (wet ? 1.3 : 1) *
        (heat ? 0.45 : 1);
      const meanT = region.meanTempC + seasonalAmp * summerness(d);
      const declination =
        ((-23.44 * Math.PI) / 180) * Math.cos((2 * Math.PI * (d + 11)) / 365);
      let dayRain = 0;
      let dayMaxWind = 0;
      for (let hr = 0; hr < 24; hr++) {
        const h = d * 24 + hr;
        const i = r * HOURS + h;
        const a = anomaly[d] + ((anomaly[d + 1] - anomaly[d]) * hr) / 24;
        const cycle = Math.cos((2 * Math.PI * (hr - 15)) / 24);
        let t = meanT + a + diurnal * cycle + 0.3 * rng.normal();
        let w =
          windLevel *
          (1 + 0.28 * Math.cos((2 * Math.PI * (hr - 14)) / 24)) *
          (1 + 0.12 * rng.normal());
        let rn =
          wet && hr >= rainStart && hr < rainStart + rainDuration
            ? (rainTotal / rainDuration) * rng.range(0.4, 1.6)
            : 0;
        const hourAngle = ((hr + 0.5 - 12.5) * 15 * Math.PI) / 180;
        const sinElev =
          Math.sin(lat) * Math.sin(declination) +
          Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
        let s =
          sinElev > 0
            ? 1080 *
              sinElev ** 1.2 *
              cloud *
              rng.range(0.92, 1) *
              (rn > 0 ? 0.6 : 1)
            : 0;
        let hum =
          (region.coastal ? 74 : 62) +
          8 * winterness(d) -
          2.2 * diurnal * cycle -
          (heat ? 22 : 0) +
          3 * rng.normal();
        if (rn > 0) hum = 90 + 7 * rng.next();

        const k = stormReach >= 0 ? stormStrength(h) : 0;
        if (k > 0) {
          const reach = STORM_REACH[stormReach];
          w = Math.max(
            w,
            k * stormPeak * reach * clamp(1 + 0.05 * rng.normal(), 0.9, 1.06),
          );
          if (storm) {
            rn = Math.max(rn, (stormRainPerDay / 24) * rng.range(0.6, 1.4));
            hum = 94 + 5 * rng.next();
          }
          s *= 1 - 0.85 * k;
          t -= 2.5 * k;
        }

        temperature[i] = round(t, 1);
        wind[i] = round(Math.max(0.2, w), 1);
        rain[i] = round(rn, 1);
        humidity[i] = Math.round(clamp(hum, 12, 100));
        solar[i] = Math.round(s);
        dayRain += rain[i];
        dayMaxWind = Math.max(dayMaxWind, wind[i]);
      }
      dailyRain[r * DAYS + d] = round(dayRain, 1);
      dailyMaxWind[r * DAYS + d] = dayMaxWind;
    }
  }
  cached = {
    temperature,
    wind,
    rain,
    humidity,
    solar,
    dailyRain,
    dailyMaxWind,
  };
  return cached;
}
