/**
 * Two small "bring your own data" sample files a visitor can upload to try
 * Uploads. They are not part of the Meridia Catalog: seeded generators of
 * their own, fictional and SPECIMEN (see fixtures/canvas/README.md).
 */
import {
  DAYS,
  dateString,
  isHoliday,
  monthOf,
  summerness,
  timestampAt,
  weekday,
} from "./calendar";
import { csvLine } from "./csv";
import { clamp, rngFor, round } from "./prng";

/** Aurel Riverside Market: daily sales of 13 stalls, closed on Mondays. */
export function marketStallSalesCsv(): string {
  const rng = rngFor("sample:market-stall-sales");
  const stalls: [string, string, number, number][] = [
    // name, category, units per day, price MDC
    ["Orchard Row Fruit", "fruit and veg", 140, 4.2],
    ["Greenleaf Greens", "fruit and veg", 110, 3.6],
    ["Halden Smokehouse", "fish", 55, 16.5],
    ["Tide Line Oysters", "fish", 40, 22],
    ["Velmora Cheese Cave", "dairy", 60, 12.8],
    ["Brennick Bakehouse", "bakery", 210, 5.5],
    ["Sugar & Salt", "bakery", 120, 4.8],
    ["Lantern Noodles", "hot food", 160, 11],
    ["Corranth Grill", "hot food", 140, 13.5],
    ["Frost Cart Ices", "ice cream", 150, 4.5],
    ["Kestrel Coffee", "coffee", 260, 4],
    ["Arvena Flowers", "flowers", 45, 18],
    ["Saltmere Soap Co.", "crafts", 30, 9.5],
  ];
  /** The soap stall joins on 1 June. */
  const soapFrom = 151;
  let out = csvLine([
    "date",
    "stall",
    "category",
    "units",
    "revenue_mdc",
    "rain_mm",
  ]);
  let wet = 0;
  for (let d = 0; d < DAYS; d++) {
    const wd = weekday(d);
    if (wd === 1) continue;
    wet =
      0.5 * wet + (rng.chance(0.18 + (0.12 * (1 - summerness(d))) / 2) ? 1 : 0);
    const rain =
      wet > 0.6 ? round(-6 * Math.log(Math.max(rng.next(), 1e-6)), 1) : 0;
    const crowd =
      (wd === 6 ? 1.45 : wd === 0 ? 1.3 : wd === 5 ? 1.1 : 0.85) *
      (isHoliday(d) ? 1.25 : 1) *
      (monthOf(d) === 12 ? 1.25 : 1) *
      (1 - clamp(rain / 30, 0, 0.55));
    for (const [i, [stall, category, units, price]] of stalls.entries()) {
      if (i === stalls.length - 1 && d < soapFrom) continue;
      let f = crowd * (1 + 0.1 * rng.normal());
      if (category === "ice cream")
        f *= clamp(1 + 0.9 * summerness(d), 0.15, 2);
      if (category === "coffee" || category === "hot food")
        f *= 1 + (0.2 * (1 - summerness(d))) / 2;
      if (category === "flowers" && dateString(d).slice(5) === "12-24")
        f *= 2.5;
      if (category === "fruit and veg") f *= 1 + 0.15 * summerness(d);
      const sold = Math.max(0, Math.round(units * f));
      const revenue = round(sold * price * (1 + 0.03 * rng.normal()), 2);
      out += csvLine([dateString(d), stall, category, sold, revenue, rain]);
    }
  }
  return out;
}

/** Halden Bikes: individual trips in Port Halden, March to April 2025. */
export function bikeShareTripsCsv(): string {
  const rng = rngFor("sample:bike-share-trips");
  const stations = [
    "Harbour Steps",
    "Ferry Terminal",
    "Central Station",
    "Market Square",
    "University Gate",
    "Gullscar Road",
    "Docklands",
    "Halden Heights",
    "Riverside Park",
    "Old Customs House",
  ];
  /** Rough distances between stations, km, from positions on a line and a ring. */
  const pos = stations.map((_, i) => [
    Math.cos(i * 1.7) * 2.4,
    Math.sin(i * 1.1) * 1.8,
  ]);
  const distance = (a: number, b: number) =>
    Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]) * 1.3 + 0.4;
  const hourWeights = [
    0.2, 0.1, 0.05, 0.05, 0.1, 0.4, 1.4, 3.2, 3.6, 1.6, 1, 1.1, 1.4, 1.3, 1.1,
    1.3, 2.2, 3.4, 2.6, 1.6, 1.1, 0.8, 0.5, 0.3,
  ];
  const restWeights = hourWeights.map((w, h) =>
    h >= 10 && h <= 17 ? 1.9 : w * 0.5,
  );
  const first = 59; // 1 March
  const last = 119; // 30 April
  let out = csvLine([
    "trip_id",
    "started_at",
    "ended_at",
    "start_station",
    "end_station",
    "duration_min",
    "distance_km",
    "member_type",
    "bike_type",
  ]);
  let id = 0;
  for (let d = first; d <= last; d++) {
    const wd = weekday(d);
    const rest = wd === 0 || wd === 6 || isHoliday(d);
    const rainy = rng.chance(0.3);
    const trips = rng.poisson(
      (rest ? 110 : 145) * (rainy ? 0.55 : 1) * (1 - (d - first) / 400),
    );
    const starts: number[] = [];
    for (let t = 0; t < trips; t++) {
      const hour = rng.weightedIndex(rest ? restWeights : hourWeights);
      starts.push(hour * 60 + rng.int(0, 59));
    }
    starts.sort((a, b) => a - b);
    for (const minute of starts) {
      const from = rng.int(0, stations.length - 1);
      let to = rng.int(0, stations.length - 2);
      if (to >= from) to++;
      if (rng.chance(rest ? 0.12 : 0.04)) to = from;
      const member = rng.chance(rest ? 0.45 : 0.78) ? "member" : "casual";
      const electric = rng.chance(0.38);
      const km = round(
        to === from
          ? rng.range(1.5, 9)
          : distance(from, to) * rng.range(1, 1.25),
        2,
      );
      const speed =
        (electric ? 17 : 12.5) *
        rng.range(0.75, 1.15) *
        (member === "casual" ? 0.8 : 1);
      const duration = Math.max(
        2,
        Math.round((km / speed) * 60 + rng.range(1, 4)),
      );
      const start = d * 1440 + minute;
      id++;
      out += csvLine([
        `T${String(240000 + id)}`,
        timestampAt(start),
        timestampAt(start + duration),
        stations[from],
        stations[to],
        duration,
        km,
        member,
        electric ? "electric" : "classic",
      ]);
    }
  }
  return out;
}
