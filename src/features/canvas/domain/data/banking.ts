/**
 * Anonymous daily card spend in the catchments of Corvane Savings Bank's 24
 * branches, by merchant category. Weekly rhythm, paydays (the 15th and the
 * last day of the month), the December peak, holidays, the ferry strike and
 * the storm all show.
 */
import {
  DAYS,
  dateString,
  dayOfMonth,
  daysInMonth,
  inRange,
  isHoliday,
  monthOf,
  summerness,
  weekday,
  winterness,
} from "./calendar";
import { BRANCHES } from "./geography";
import { rngFor, round } from "./prng";
import { STORY } from "./story";
import type { Cell } from "./types";

export const CARD_CATEGORIES = [
  "groceries",
  "dining",
  "fuel",
  "transport",
  "utilities",
  "retail",
  "health",
  "entertainment",
  "travel",
  "education",
  "home",
  "online",
] as const;
type Category = (typeof CARD_CATEGORIES)[number];

/** Transactions per day per unit of branch size, and the average ticket, MDC. */
const BASE: Record<Category, [number, number]> = {
  groceries: [420, 64],
  dining: [260, 38],
  fuel: [150, 72],
  transport: [210, 9.5],
  utilities: [40, 145],
  retail: [230, 58],
  health: [70, 47],
  entertainment: [90, 31],
  travel: [25, 310],
  education: [12, 220],
  home: [60, 95],
  online: [240, 42],
};

/** Weekday factors, Sunday first. */
const WEEK: Record<Category, number[]> = {
  groceries: [1.1, 0.9, 0.9, 0.95, 1, 1.1, 1.3],
  dining: [1.1, 0.8, 0.85, 0.9, 1, 1.35, 1.4],
  fuel: [0.85, 1, 1, 1, 1.05, 1.15, 0.95],
  transport: [0.5, 1.15, 1.15, 1.15, 1.15, 1.1, 0.65],
  utilities: [0.3, 1.3, 1.2, 1.2, 1.2, 1.1, 0.4],
  retail: [1.15, 0.8, 0.85, 0.9, 1, 1.15, 1.4],
  health: [0.4, 1.2, 1.15, 1.15, 1.1, 1.05, 0.7],
  entertainment: [1.2, 0.7, 0.7, 0.8, 0.95, 1.3, 1.5],
  travel: [1, 1, 0.95, 0.95, 1, 1.1, 1],
  education: [0.3, 1.3, 1.2, 1.2, 1.2, 1, 0.5],
  home: [1.2, 0.85, 0.85, 0.9, 0.95, 1, 1.35],
  online: [1.15, 1, 0.95, 0.95, 0.95, 0.95, 1.05],
};

const PAYDAY_BOOST: Partial<Record<Category, number>> = {
  groceries: 0.1,
  dining: 0.22,
  retail: 0.25,
  entertainment: 0.2,
  online: 0.2,
  home: 0.15,
};

/** True on a payday and the two days after it. */
export function isPaydayWindow(day: number): boolean {
  const dom = dayOfMonth(day);
  const last = daysInMonth(monthOf(day));
  return dom === 15 || dom === 16 || dom === 17 || dom === last || dom <= 2;
}

function seasonFactor(category: Category, day: number): number {
  const month = monthOf(day);
  const dom = dayOfMonth(day);
  const summer = Math.max(0, summerness(day));
  if (month === 12) {
    const ramp = dom <= 24 ? dom / 24 : dom <= 26 ? 0.3 : 0.6;
    const peak: Partial<Record<Category, number>> = {
      retail: 0.7,
      online: 0.5,
      dining: 0.3,
      groceries: 0.2,
      travel: 0.35,
      entertainment: 0.25,
      home: 0.2,
    };
    return 1 + (peak[category] ?? 0) * ramp;
  }
  switch (category) {
    case "travel":
      return 1 + 0.35 * summer;
    case "dining":
      return 1 + 0.08 * summer;
    case "utilities":
      return 1 + 0.25 * winterness(day);
    case "retail":
      return month === 1 ? 0.85 : 1;
    case "education":
      return month === 2 ? 1.8 : month === 1 ? 0.5 : 1;
    default:
      return 1;
  }
}

const HOLIDAY: Partial<Record<Category, number>> = {
  retail: 0.5,
  groceries: 0.7,
  dining: 1.2,
  transport: 0.5,
  utilities: 0.2,
  health: 0.4,
  education: 0.2,
};

export const CARD_SPEND_ROWS = DAYS * BRANCHES.length * CARD_CATEGORIES.length;

export function* cardSpendRows(): Generator<Cell[]> {
  const rng = rngFor("card_spend");
  for (let d = 0; d < DAYS; d++) {
    const date = dateString(d);
    const wd = weekday(d);
    const holiday = isHoliday(d);
    const payday = isPaydayWindow(d);
    const strike = inRange(d, STORY.ferryStrike.start, STORY.ferryStrike.end);
    const storm = inRange(d, STORY.storm.start, STORY.storm.end);
    const afterStorm =
      !storm && inRange(d - 2, STORY.storm.start, STORY.storm.end);
    for (const branch of BRANCHES) {
      const branchDay = 1 + 0.04 * rng.normal();
      const stormBranch = branch.regionCode === STORY.storm.region;
      for (const category of CARD_CATEGORIES) {
        const [txn, ticket] = BASE[category];
        let f =
          branch.size *
          branchDay *
          WEEK[category][wd] *
          seasonFactor(category, d);
        if (holiday) f *= HOLIDAY[category] ?? 1;
        if (payday) f *= 1 + (PAYDAY_BOOST[category] ?? 0);
        if (strike && branch.coastal) {
          if (category === "transport") f *= 0.62 + 0.04 * rng.normal();
          if (category === "fuel") f *= 1.12;
        }
        if (stormBranch && storm)
          f *=
            category === "online" ? 1.25 : category === "utilities" ? 1 : 0.62;
        if (
          stormBranch &&
          afterStorm &&
          (category === "groceries" ||
            category === "retail" ||
            category === "home")
        ) {
          f *= 1.15;
        }
        const transactions = Math.max(
          0,
          Math.round(txn * f * (1 + 0.06 * rng.normal())),
        );
        const amount =
          transactions *
          ticket *
          (1 + 0.05 * rng.normal()) *
          (monthOf(d) === 12 && category === "retail" ? 1.1 : 1);
        yield [
          date,
          branch.id,
          branch.regionCode,
          category,
          transactions,
          round(Math.max(0, amount), 2),
        ];
      }
    }
  }
}
