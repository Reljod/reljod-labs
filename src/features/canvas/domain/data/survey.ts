/**
 * The 2025 household survey: 30,000 households, sampled in proportion to
 * population, with weights that bring them back to the national total.
 * Income differs by region, tenure, size and age; energy spend by household
 * size, income and climate (an annual figure, so no week of weather shows).
 */
import { MUNICIPALITIES, REGIONS, ROUTES } from "./geography";
import { clamp, rngFor, round } from "./prng";
import type { Cell } from "./types";

export const SURVEY_ROWS = 30_000;

const REGION_INCOME: Record<string, number> = {
  KES: 0.95,
  ARV: 1.05,
  TAM: 0.94,
  VEL: 0.84,
  DUR: 1.18,
  SAL: 1.0,
  FEN: 0.86,
  HAL: 1.12,
};

export const TENURES = [
  "owner_outright",
  "mortgage",
  "private_rent",
  "social_rent",
] as const;
const TENURE_WEIGHTS = [0.26, 0.34, 0.28, 0.12];
const TENURE_INCOME = [1.05, 1.3, 0.92, 0.62];
const TENURE_AGE = [61, 44, 34, 48];
/** Private renters answer less often, so each one stands for more households. */
const TENURE_RESPONSE = [1.05, 1, 0.78, 0.9];

const SIZE_WEIGHTS = [0.27, 0.33, 0.16, 0.15, 0.06, 0.03];
const AVERAGE_HOUSEHOLD = 2.45;

const MODES = ["car", "rail", "bus", "ferry", "bike", "walk"] as const;
const MODE_MINUTES: Record<(typeof MODES)[number], [number, number]> = {
  car: [25, 12],
  rail: [38, 15],
  bus: [32, 12],
  ferry: [46, 15],
  bike: [18, 8],
  walk: [14, 7],
};

const FERRY_TOWNS = new Set(
  ROUTES.filter((r) => r.mode === "ferry").flatMap((r) => [r.from, r.to]),
);

export function* householdSurveyRows(): Generator<Cell[]> {
  const rng = rngFor("household_survey");
  const totalPop = REGIONS.reduce((s, r) => s + r.population, 0);
  const regionWeights = REGIONS.map((r) => r.population);
  const towns = REGIONS.map((r) =>
    MUNICIPALITIES.filter((m) => m.regionCode === r.code),
  );
  const baseWeight = totalPop / AVERAGE_HOUSEHOLD / SURVEY_ROWS;
  for (let n = 0; n < SURVEY_ROWS; n++) {
    const region = REGIONS[rng.weightedIndex(regionWeights)];
    const regionTowns = towns[REGIONS.indexOf(region)];
    const town =
      regionTowns[rng.weightedIndex(regionTowns.map((m) => m.population))];
    const isCapital = town.name === region.capital;
    const tenureWeights = TENURE_WEIGHTS.map((w, i) =>
      isCapital && i >= 2 ? w * 1.4 : w,
    );
    const t = rng.weightedIndex(tenureWeights);
    const size = 1 + rng.weightedIndex(SIZE_WEIGHTS);
    const age = Math.round(clamp(TENURE_AGE[t] + 13 * rng.normal(), 18, 92));
    const retired = age >= 67;
    const income =
      Math.round(
        (4800 *
          REGION_INCOME[region.code] *
          TENURE_INCOME[t] *
          (1 + 0.12 * Math.min(size - 1, 3)) *
          (retired ? 0.6 : 1) *
          Math.exp(0.42 * rng.normal() - 0.088)) /
          10,
      ) * 10;
    const energy =
      90 +
      26 * size +
      0.012 * income +
      9 * Math.max(0, 18 - region.meanTempC) +
      14 * rng.normal();
    const carChance = clamp(
      0.35 +
        income / 20_000 +
        (region.coastal ? 0 : 0.1) -
        (isCapital ? 0.12 : 0),
      0.1,
      0.97,
    );
    const hasCar = rng.chance(carChance);
    let mode: string = "none";
    let minutes: number | null = null;
    if (!retired && !rng.chance(0.12)) {
      const weights = [
        hasCar ? 0.62 : 0.05,
        0.18 + (isCapital ? 0.08 : 0),
        0.12,
        FERRY_TOWNS.has(town.name) ? 0.25 : region.coastal ? 0.02 : 0,
        0.05,
        0.07,
      ];
      const m = MODES[rng.weightedIndex(weights)];
      const [mean, sd] = MODE_MINUTES[m];
      mode = m;
      minutes = Math.round(clamp(mean + sd * rng.normal(), 3, 150));
    }
    const weight = round(
      (baseWeight / TENURE_RESPONSE[t]) *
        (1 + 0.12 * clamp(rng.normal(), -2, 2)),
      2,
    );
    yield [
      `HH${String((n * 7919 + 104_729) % 10_000_000).padStart(7, "0")}`,
      region.code,
      town.name,
      size,
      income,
      round(Math.max(40, energy), 2),
      TENURES[t],
      hasCar,
      mode,
      minutes,
      age,
      weight,
    ];
  }
}
