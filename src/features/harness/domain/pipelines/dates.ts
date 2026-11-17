/**
 * Calendar arithmetic for the Pipelines' checks, on ISO dates (`YYYY-MM-DD`)
 * and contribution months (`YYYY-MM`), always in UTC so a check gives the
 * same answer wherever it runs. Pure.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** A contribution month, `YYYY-MM`. */
export function isPeriod(value: unknown): value is string {
  return typeof value === "string" && PERIOD.test(value);
}

export function toDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The time zone the bank works in. Cayman keeps UTC-5 all year (no daylight saving). */
export const BANK_TIME_ZONE = "America/Cayman";

const BANK_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: BANK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The bank's calendar day at `now`, `YYYY-MM-DD`. A Run started at 02:00 UTC
 * is still the evening before in George Town, and that is the day its Rules
 * and deadlines are read on.
 */
export function bankToday(now: Date = new Date()): string {
  return BANK_DAY.format(now);
}

export function addDays(iso: string, days: number): string {
  return isoOf(new Date(toDate(iso).getTime() + days * DAY_MS));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** The same day `months` later (or earlier), held to the end of a shorter month. */
export function addMonths(iso: string, months: number): string {
  const date = toDate(iso);
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return isoOf(new Date(Date.UTC(year, month, day)));
}

export function addYears(iso: string, years: number): string {
  return addMonths(iso, years * 12);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

/** Whole calendar months from `from` to `to`, counting a month only once its day is reached. */
export function wholeMonthsBetween(from: string, to: string): number {
  const a = toDate(from);
  const b = toDate(to);
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

/** Whole years from `from` to `to`: an age, or time away. */
export function wholeYearsBetween(from: string, to: string): number {
  return Math.floor(wholeMonthsBetween(from, to) / 12);
}

/** Years from `from` to `to` to one decimal place, for showing. */
export function yearsToOneDecimal(from: string, to: string): number {
  return Math.round((daysBetween(from, to) / 365.25) * 10) / 10;
}

/** The month a date falls in, `YYYY-MM`. */
export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The first day of a month: what the database stores as a Schedule's period. */
export function periodStart(period: string): string {
  return `${period}-01`;
}

/** The last day of a month. */
export function periodEnd(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return `${period}-${String(daysInMonth(year, month - 1)).padStart(2, "0")}`;
}

export function addPeriods(period: string, months: number): string {
  return periodOf(addMonths(periodStart(period), months));
}

/**
 * Day `day` of the month `offset` months after `period`, held to the end of
 * a shorter month: `dayAfterPeriod("2026-04", 1, 15)` is 15 May 2026, the
 * date April's contributions are due.
 */
export function dayAfterPeriod(
  period: string,
  offset: number,
  day: number,
): string {
  const month = addPeriods(period, offset);
  const last = Number(periodEnd(month).slice(8));
  return `${month}-${String(Math.min(Math.max(1, day), last)).padStart(2, "0")}`;
}

/** `15 May 2026`, for Drafts and summaries. */
export function formatDate(iso: string): string {
  return toDate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `April 2026`. */
export function formatPeriod(period: string): string {
  return toDate(periodStart(period)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Rounds to cents. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** `CI$1,234.50`: the notation of the Act and the DLP's documents. */
export function formatKyd(value: number): string {
  return `CI$${round2(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
