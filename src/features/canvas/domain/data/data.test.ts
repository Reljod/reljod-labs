import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dayIndex, isRestDay, weekday } from "./calendar";
import { pointInPolygon, REGION_INDEX } from "./geography";
import {
  CATALOG,
  type Cell,
  REGIONS,
  STORY,
  tableCsvChunks,
  tableRows,
} from "./index";

const rows = (name: string): Cell[][] => Array.from(tableRows(name));
const day = (text: string) => dayIndex(String(text).slice(0, 10));
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const pct = (a: number, b: number) => (a / b - 1) * 100;

function inRange(d: number, start: string, end: string) {
  return d >= dayIndex(start) && d <= dayIndex(end);
}

describe("the Meridia catalog", { timeout: 60_000 }, () => {
  it("has exact row counts, matching column counts and a plausible size", () => {
    let total = 0;
    for (const table of CATALOG) {
      let n = 0;
      for (const row of tableRows(table.name)) {
        if (n === 0) expect(row.length, table.name).toBe(table.columns.length);
        n++;
      }
      expect(n, table.name).toBe(table.rows);
      total += n;
    }
    expect(total).toBeGreaterThanOrEqual(900_000);
    expect(total).toBeLessThanOrEqual(1_200_000);
  });

  it("is deterministic: the same CSV checksum twice", () => {
    const checksum = () => {
      const hash = createHash("sha256");
      for (const table of CATALOG) {
        for (const chunk of tableCsvChunks(table.name, 50_000))
          hash.update(chunk);
      }
      return hash.digest("hex");
    };
    expect(checksum()).toBe(checksum());
  });

  it("writes RFC 4180 CSV with a header and one line per row", () => {
    const text = Array.from(tableCsvChunks("household_survey", 7_000)).join("");
    const lines = text.split("\n");
    expect(lines[0]).toBe(
      CATALOG.find((t) => t.name === "household_survey")
        ?.columns.map((c) => c.name)
        .join(","),
    );
    expect(lines.length).toBe(30_000 + 2); // header + rows + trailing ""
    expect(lines.at(-1)).toBe("");
    // commute_minutes is null for "none": an empty field.
    expect(text).toMatch(/,none,,/);
    expect(text).toMatch(/,(true|false),/);
  });

  it("marks the restricted survey columns", () => {
    const survey = CATALOG.find((t) => t.name === "household_survey");
    const restricted = survey?.columns
      .filter((c) => c.restrictedByDefault)
      .map((c) => c.name);
    expect(restricted).toEqual([
      "household_id",
      "monthly_income_mdc",
      "respondent_age",
    ]);
  });

  it("has no NaN and no negative value where one is impossible", () => {
    for (const table of CATALOG) {
      const numeric = table.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.type === "integer" || c.type === "double");
      for (const row of tableRows(table.name)) {
        for (const { c, i } of numeric) {
          const v = row[i];
          if (v === null) continue;
          if (typeof v !== "number" || !Number.isFinite(v)) {
            throw new Error(`${table.name}.${c.name} is not a number: ${v}`);
          }
          if (c.name !== "temperature_c" && v < 0) {
            throw new Error(`${table.name}.${c.name} is negative: ${v}`);
          }
        }
      }
    }
  });

  it("draws eight regions whose centroids lie inside their polygons", () => {
    expect(REGIONS).toHaveLength(8);
    for (const region of REGIONS) {
      expect(pointInPolygon(region.centroid, region.polygon), region.code).toBe(
        true,
      );
      for (const [x, y] of region.polygon) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1000);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(700);
      }
    }
    // Every region shares at least one edge with a neighbour.
    const key = (a: number[], b: number[]) =>
      [a.join(":"), b.join(":")].sort().join("|");
    const edges = new Map<string, number>();
    for (const region of REGIONS) {
      region.polygon.forEach((p, i) => {
        const k = key(p, region.polygon[(i + 1) % region.polygon.length]);
        edges.set(k, (edges.get(k) ?? 0) + 1);
      });
    }
    for (const region of REGIONS) {
      const shared = region.polygon.some(
        (p, i) =>
          (edges.get(key(p, region.polygon[(i + 1) % region.polygon.length])) ??
            0) === 2,
      );
      expect(shared, region.code).toBe(true);
    }
    for (const station of rows("air_stations")) {
      const region = REGIONS[REGION_INDEX[station[2] as string]];
      expect(
        pointInPolygon(
          [station[5] as number, station[6] as number],
          region.polygon,
        ),
        station[0] as string,
      ).toBe(true);
    }
  });
});

describe("energy", { timeout: 60_000 }, () => {
  const load = rows("grid_load");
  const nationalLoad = new Map<string, number>();
  for (const [ts, , mw] of load) {
    nationalLoad.set(
      ts as string,
      (nationalLoad.get(ts as string) ?? 0) + (mw as number),
    );
  }

  it("generates national load plus 4-6% losses every hour", () => {
    const generation = new Map<string, number>();
    for (const [ts, , , mw] of tableRows("grid_generation")) {
      generation.set(
        ts as string,
        (generation.get(ts as string) ?? 0) + (mw as number),
      );
    }
    expect(generation.size).toBe(8760);
    for (const [ts, gen] of generation) {
      const ratio = gen / (nationalLoad.get(ts) ?? 1);
      if (ratio < 1.04 || ratio > 1.06) throw new Error(`${ts}: ${ratio}`);
    }
  });

  it("plants the heatwave: heat, a 25% load peak, the national peak hour", () => {
    const hw = STORY.heatwave;
    const otherFeb = (d: number) =>
      d >= dayIndex("2025-02-01") &&
      d <= dayIndex("2025-02-28") &&
      !inRange(d, hw.start, hw.end);
    // Temperature: heatwave regions vs the rest of February.
    const temps = { in: [] as number[], out: [] as number[] };
    for (const [ts, region, t] of tableRows("weather")) {
      if (!hw.regions.includes(region as string)) continue;
      const d = day(ts as string);
      if (inRange(d, hw.start, hw.end)) temps.in.push(t as number);
      else if (otherFeb(d)) temps.out.push(t as number);
    }
    const anomaly = mean(temps.in) - mean(temps.out);
    expect(anomaly).toBeGreaterThan(hw.temperatureAnomalyC[0] - 1.5);
    expect(anomaly).toBeLessThan(hw.temperatureAnomalyC[1] + 1.5);

    // Daily peak of the three regions' load.
    const peaks = new Map<number, number>();
    const hourly = new Map<string, number>();
    for (const [ts, region, mw] of load) {
      if (!hw.regions.includes(region as string)) continue;
      hourly.set(
        ts as string,
        (hourly.get(ts as string) ?? 0) + (mw as number),
      );
    }
    for (const [ts, mw] of hourly) {
      const d = day(ts);
      peaks.set(d, Math.max(peaks.get(d) ?? 0, mw));
    }
    const peakIn = mean(
      [...peaks]
        .filter(([d]) => inRange(d, hw.start, hw.end))
        .map(([, v]) => v),
    );
    const peakOut = mean(
      [...peaks].filter(([d]) => otherFeb(d)).map(([, v]) => v),
    );
    const rise = pct(peakIn, peakOut);
    expect(rise).toBeGreaterThan(hw.loadPeakIncreasePct[0]);
    expect(rise).toBeLessThan(hw.loadPeakIncreasePct[1]);

    let peakTs = "";
    let peak = 0;
    for (const [ts, mw] of nationalLoad) {
      if (mw > peak) {
        peak = mw;
        peakTs = ts;
      }
    }
    expect(inRange(day(peakTs), hw.start, hw.end)).toBe(true);
  });

  it("plants the heatwave in generation and air: hydro down, gas, ozone and PM2.5 up", () => {
    const hw = STORY.heatwave;
    const window = (d: number) =>
      d >= dayIndex("2025-02-01") && d <= dayIndex("2025-02-28");
    const sums = new Map<string, number[]>();
    const add = (key: string, v: number) => {
      const list = sums.get(key) ?? [];
      list.push(v);
      sums.set(key, list);
    };
    for (const [ts, region, source, mw] of tableRows("grid_generation")) {
      const d = day(ts as string);
      if (!window(d)) continue;
      const inside = inRange(d, hw.start, hw.end) ? "in" : "out";
      if (source === "gas") add(`gas:${inside}`, mw as number);
      if (source === "hydro" && hw.regions.includes(region as string))
        add(`hydro:${inside}`, mw as number);
    }
    for (const [ts, , region, pm25, , o3] of tableRows("air_quality")) {
      const d = day(ts as string);
      if (!window(d) || !hw.regions.includes(region as string)) continue;
      const inside = inRange(d, hw.start, hw.end) ? "in" : "out";
      add(`pm25:${inside}`, pm25 as number);
      add(`o3:${inside}`, o3 as number);
    }
    const ratio = (k: string) =>
      mean(sums.get(`${k}:in`) ?? []) / mean(sums.get(`${k}:out`) ?? []);
    expect(ratio("hydro")).toBeLessThan(0.75);
    expect(ratio("gas")).toBeGreaterThan(1.2);
    expect(ratio("o3")).toBeGreaterThan(1.15);
    expect(ratio("pm25")).toBeGreaterThan(1.3);
  });
});

describe("transport and the harbour", { timeout: 60_000 }, () => {
  const ridership = rows("ridership");
  const daily = new Map<string, number>(); // route|day -> boardings
  for (const [date, , route, , boardings] of ridership) {
    const k = `${route}|${day(date as string)}`;
    daily.set(k, (daily.get(k) ?? 0) + (boardings as number));
  }
  const routeDays = (route: string, test: (d: number) => boolean) =>
    [...daily]
      .filter(
        ([k]) => k.startsWith(`${route}|`) && test(Number(k.split("|")[1])),
      )
      .map(([, v]) => v);

  it("plants the ferry strike: ferries cancelled, parallel rail up 30-40%", () => {
    const strike = STORY.ferryStrike;
    for (const [date, , , mode, boardings, , cancelled] of ridership) {
      if (
        mode === "ferry" &&
        inRange(day(date as string), strike.start, strike.end)
      ) {
        expect(cancelled).toBe(true);
        expect(boardings).toBe(0);
      }
    }
    // Same weekdays one and two weeks either side.
    const s = dayIndex(strike.start);
    const e = dayIndex(strike.end);
    const control = (d: number) =>
      [-14, -7, 7, 14].some((k) => d - k >= s && d - k <= e);
    for (const { railRouteId } of strike.parallelRail) {
      const rise = pct(
        mean(routeDays(railRouteId, (d) => d >= s && d <= e)),
        mean(routeDays(railRouteId, control)),
      );
      expect(rise, railRouteId).toBeGreaterThan(strike.railIncreasePct[0] - 6);
      expect(rise, railRouteId).toBeLessThan(strike.railIncreasePct[1] + 6);
    }
  });

  it("opens the new rail line on 1 July and it takes the ferry's riders", () => {
    const nr = STORY.newRail;
    const open = dayIndex(nr.opened);
    const firstDay = ridership.find((r) => r[2] === nr.routeId)?.[0];
    expect(firstDay).toBe(nr.opened);
    const workday = (d: number) => !isRestDay(d);
    const before = (d: number) =>
      workday(d) &&
      d >= open - 42 &&
      d < open &&
      !inRange(d, STORY.ferryStrike.start, STORY.ferryStrike.end);
    const after = (d: number) =>
      workday(d) &&
      d >= open + nr.rampDays &&
      d < open + nr.rampDays + 42 &&
      !inRange(d, STORY.storm.start, STORY.storm.end);
    const change = (route: string) =>
      mean(routeDays(route, after)) / mean(routeDays(route, before));
    const others = ["FR-01", "FR-02", "FR-03", "FR-05", "FR-06", "FR-07"].map(
      change,
    );
    const drop = (1 - change(nr.fromFerryRouteId) / mean(others)) * 100;
    expect(drop).toBeGreaterThan(nr.ferryDropPct[0]);
    expect(drop).toBeLessThan(nr.ferryDropPct[1]);
    expect(mean(routeDays(nr.routeId, after))).toBeGreaterThan(1500);
  });

  it("closes Port Halden for the storm, then works off a backlog", () => {
    const st = STORY.storm;
    const arrivals = new Map<number, number>();
    const ferryCallsInStrike: Cell[][] = [];
    for (const call of tableRows("harbour_calls")) {
      const d = day(call[4] as string);
      if (
        call[3] === "ferry" &&
        inRange(d, STORY.ferryStrike.start, STORY.ferryStrike.end)
      ) {
        ferryCallsInStrike.push(call);
      }
      if (call[1] !== st.port) continue;
      arrivals.set(d, (arrivals.get(d) ?? 0) + 1);
      const arr = call[4] as string;
      const dep = call[5] as string;
      // Nothing arrives or leaves while the port is closed.
      expect(arr >= st.closedFrom && arr < st.closedUntil).toBe(false);
      expect(dep >= st.closedFrom && dep < st.closedUntil).toBe(false);
    }
    expect(ferryCallsInStrike).toEqual([]);
    const s = dayIndex(st.start);
    expect(arrivals.get(s) ?? 0).toBe(0);
    expect(arrivals.get(s + 1) ?? 0).toBe(0);
    const normal = mean(
      [...arrivals].filter(([d]) => d > s + 10 && d < s + 40).map(([, v]) => v),
    );
    expect(arrivals.get(s + 2) ?? 0).toBeGreaterThan(normal * 1.2);

    const wind: number[] = [];
    const rain = new Map<number, number>();
    for (const [ts, region, , w, r] of tableRows("weather")) {
      if (region !== st.region) continue;
      const d = day(ts as string);
      if (!inRange(d, st.start, st.end)) continue;
      wind.push(w as number);
      rain.set(d, (rain.get(d) ?? 0) + (r as number));
    }
    expect(Math.max(...wind)).toBeGreaterThanOrEqual(st.peakWindMs[0]);
    expect(Math.max(...wind)).toBeLessThanOrEqual(st.peakWindMs[1]);
    for (const mm of rain.values()) {
      expect(mm).toBeGreaterThanOrEqual(st.dailyRainMm[0]);
      expect(mm).toBeLessThanOrEqual(st.dailyRainMm[1]);
    }
  });
});

describe("budgets, survey and card spend", { timeout: 60_000 }, () => {
  it("reconciles budget totals everywhere except the planted region", () => {
    const sums = new Map<string, [number, number]>();
    for (const [year, muni, , , , budgeted, actual] of tableRows(
      "municipal_budget_lines",
    )) {
      const k = `${year}|${muni}`;
      const [b, a] = sums.get(k) ?? [0, 0];
      sums.set(k, [b + (budgeted as number), a + (actual as number)]);
    }
    const gap = STORY.budgetGap;
    let planted = 0;
    for (const [year, muni, region, budget, actual] of tableRows(
      "municipal_budget_totals",
    )) {
      const [b, a] = sums.get(`${year}|${muni}`) ?? [0, 0];
      expect(budget).toBe(b);
      if (region === gap.region && gap.fiscalYears.includes(year as number)) {
        const over = pct(actual as number, a);
        expect(over).toBeGreaterThanOrEqual(gap.overstatementPct[0]);
        expect(over).toBeLessThanOrEqual(gap.overstatementPct[1]);
        planted++;
      } else {
        expect(actual, `${year} ${muni}`).toBe(a);
      }
    }
    expect(planted).toBe(6 * gap.fiscalYears.length);
  });

  it("gives the survey regional and tenure income differences", () => {
    const income = new Map<string, number[]>();
    for (const row of tableRows("household_survey")) {
      for (const key of [`r:${row[1]}`, `t:${row[6]}`]) {
        const list = income.get(key) ?? [];
        list.push(row[4] as number);
        income.set(key, list);
      }
    }
    const m = (k: string) => mean(income.get(k) ?? []);
    expect(m("r:DUR")).toBeGreaterThan(m("r:VEL") * 1.2);
    expect(m("t:mortgage")).toBeGreaterThan(m("t:social_rent") * 1.6);
  });

  it("drops coastal transport card spend in the strike and peaks in December", () => {
    const strike = STORY.ferryStrike;
    const s = dayIndex(strike.start);
    const e = dayIndex(strike.end);
    const coastal = new Set(
      rows("bank_branches")
        .filter((b) => b[4])
        .map((b) => b[0]),
    );
    const transport = {
      in: [] as number[],
      ctl: [] as number[],
      inlandIn: [] as number[],
      inlandCtl: [] as number[],
    };
    const monthly = new Map<string, number>();
    for (const [date, branch, , category, , amount] of tableRows(
      "card_spend",
    )) {
      const d = day(date as string);
      const month = (date as string).slice(5, 7);
      if (category === "retail")
        monthly.set(month, (monthly.get(month) ?? 0) + (amount as number));
      if (category !== "transport") continue;
      const isCoastal = coastal.has(branch);
      if (d >= s && d <= e)
        (isCoastal ? transport.in : transport.inlandIn).push(amount as number);
      else if ([-7, 7].some((k) => d - k >= s && d - k <= e))
        (isCoastal ? transport.ctl : transport.inlandCtl).push(
          amount as number,
        );
    }
    const drop = -pct(mean(transport.in), mean(transport.ctl));
    expect(drop).toBeGreaterThan(strike.transportSpendDropPct[0]);
    expect(drop).toBeLessThan(strike.transportSpendDropPct[1]);
    expect(
      Math.abs(pct(mean(transport.inlandIn), mean(transport.inlandCtl))),
    ).toBeLessThan(10);
    const dec = monthly.get("12") ?? 0;
    for (const [month, total] of monthly)
      if (month !== "12") expect(dec).toBeGreaterThan(total * 1.15);
  });

  it("has paydays: retail spend is higher on the 15th-17th than on the 10th-12th", () => {
    const by = new Map<string, number[]>();
    for (const [date, , , category, , amount] of tableRows("card_spend")) {
      if (category !== "retail") continue;
      const d = day(date as string);
      if (isRestDay(d) || (date as string).slice(5, 7) === "12") continue;
      const dom = Number((date as string).slice(8, 10));
      const k =
        dom >= 15 && dom <= 17 ? "pay" : dom >= 10 && dom <= 12 ? "pre" : "";
      if (!k) continue;
      by.set(`${k}:${weekday(d)}`, [
        ...(by.get(`${k}:${weekday(d)}`) ?? []),
        amount as number,
      ]);
    }
    const pay = mean(
      [...by].filter(([k]) => k.startsWith("pay")).flatMap(([, v]) => v),
    );
    const pre = mean(
      [...by].filter(([k]) => k.startsWith("pre")).flatMap(([, v]) => v),
    );
    expect(pct(pay, pre)).toBeGreaterThan(12);
  });
});
