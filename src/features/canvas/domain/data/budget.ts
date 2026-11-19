/**
 * Municipal budgets, fiscal years 2021-2025: 24 line items per municipality,
 * and the totals each municipality reported. The totals equal the sum of the
 * lines to the crown, except in the region named by STORY.budgetGap.
 */
import { MUNICIPALITIES } from "./geography";
import { clamp, rngFor } from "./prng";
import { STORY } from "./story";
import type { Cell } from "./types";

export const FISCAL_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

/** Category, line item and the budget per resident in 2021, MDC. */
export const LINE_ITEMS: readonly [string, string, number][] = [
  ["Administration", "Council and executive", 38],
  ["Administration", "Finance and rates collection", 26],
  ["Administration", "Information technology", 21],
  ["Education", "Early childhood", 64],
  ["Education", "Primary schools", 182],
  ["Education", "Adult learning", 18],
  ["Health and care", "Community clinics", 96],
  ["Health and care", "Aged care", 88],
  ["Health and care", "Public health", 22],
  ["Transport", "Roads and bridges", 142],
  ["Transport", "Public transport subsidy", 74],
  ["Transport", "Parking and traffic", 16],
  ["Water and waste", "Water supply", 69],
  ["Water and waste", "Wastewater", 58],
  ["Water and waste", "Waste collection", 47],
  ["Housing", "Social housing", 81],
  ["Housing", "Planning and permits", 19],
  ["Housing", "Homelessness services", 14],
  ["Culture and recreation", "Libraries", 23],
  ["Culture and recreation", "Parks and sport", 44],
  ["Culture and recreation", "Arts and events", 15],
  ["Public safety", "Fire and rescue", 52],
  ["Public safety", "Emergency management", 12],
  ["Public safety", "Community safety", 17],
];

type Line = { budgeted: number; actual: number };

type Budget = {
  /** [(year * MUNICIPALITIES + municipality) * LINE_ITEMS + line] */
  lines: Line[];
  /** [year * MUNICIPALITIES + municipality]: the reported actual total. */
  reportedActual: number[];
};

let cached: Budget | null = null;

/** The budget is small (5,760 lines); it is drawn once and kept. */
function budget(): Budget {
  if (cached) return cached;
  const rng = rngFor("municipal_budget");
  const lines: Line[] = [];
  const reportedActual: number[] = [];
  const municipalFactor = MUNICIPALITIES.map(() => rng.range(0.85, 1.15));
  const growth = MUNICIPALITIES.map(() => rng.range(1.02, 1.05));
  const lineFactor = MUNICIPALITIES.map(() =>
    LINE_ITEMS.map(() => rng.range(0.85, 1.15)),
  );
  FISCAL_YEARS.forEach((year) => {
    MUNICIPALITIES.forEach((m, k) => {
      let sum = 0;
      LINE_ITEMS.forEach(([, item, perCapita], l) => {
        const budgeted =
          Math.round(
            (m.population *
              perCapita *
              municipalFactor[k] *
              lineFactor[k][l] *
              growth[k] ** (year - 2021) *
              rng.range(0.96, 1.04)) /
              1000,
          ) * 1000;
        let execution = clamp(0.975 + 0.045 * rng.normal(), 0.82, 1.14);
        // The August storm: emergency spending in the storm regions runs over.
        if (
          year === 2025 &&
          item === "Emergency management" &&
          STORY.storm.regions.includes(m.regionCode)
        ) {
          execution *= m.regionCode === STORY.storm.region ? 1.6 : 1.25;
        }
        const actual = Math.round(budgeted * execution);
        lines.push({ budgeted, actual });
        sum += actual;
      });
      const gap =
        m.regionCode === STORY.budgetGap.region &&
        STORY.budgetGap.fiscalYears.includes(year)
          ? rng.range(0.032, 0.088)
          : 0;
      reportedActual.push(Math.round(sum * (1 + gap)));
    });
  });
  cached = { lines, reportedActual };
  return cached;
}

export const BUDGET_LINE_ROWS =
  FISCAL_YEARS.length * MUNICIPALITIES.length * LINE_ITEMS.length;
export const BUDGET_TOTAL_ROWS = FISCAL_YEARS.length * MUNICIPALITIES.length;

export function* budgetLineRows(): Generator<Cell[]> {
  const { lines } = budget();
  let i = 0;
  for (const year of FISCAL_YEARS) {
    for (const m of MUNICIPALITIES) {
      for (const [category, item] of LINE_ITEMS) {
        const line = lines[i++];
        yield [
          year,
          m.name,
          m.regionCode,
          category,
          item,
          line.budgeted,
          line.actual,
        ];
      }
    }
  }
}

export function* budgetTotalRows(): Generator<Cell[]> {
  const { lines, reportedActual } = budget();
  let i = 0;
  let t = 0;
  for (const year of FISCAL_YEARS) {
    for (const m of MUNICIPALITIES) {
      let budgeted = 0;
      for (let l = 0; l < LINE_ITEMS.length; l++)
        budgeted += lines[i++].budgeted;
      yield [year, m.name, m.regionCode, budgeted, reportedActual[t++]];
    }
  }
}
