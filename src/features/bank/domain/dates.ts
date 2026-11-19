/**
 * Bank dates are calendar days as "YYYY-MM-DD" in Meridia's time (UTC).
 * Every day is a bank day: the fictional rail clears at weekends too.
 */
export type BankDate = string;

const DAY_MS = 86_400_000;

export const isBankDate = (value: unknown): value is BankDate =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const dateOf = (instant: Date): BankDate =>
  instant.toISOString().slice(0, 10);

const utc = (date: BankDate) => new Date(`${date}T00:00:00Z`);

export function addDays(date: BankDate, days: number): BankDate {
  return dateOf(new Date(utc(date).getTime() + days * DAY_MS));
}

/** The same day of a later month, or that month's last day when it is shorter. */
export function addMonths(date: BankDate, months: number): BankDate {
  const from = utc(date);
  const day = from.getUTCDate();
  const target = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1),
  );
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return dateOf(target);
}

export function daysBetween(from: BankDate, to: BankDate): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);
}

export function isMonthEnd(date: BankDate): boolean {
  return addDays(date, 1).slice(8) === "01";
}

export const monthStart = (date: BankDate): BankDate =>
  `${date.slice(0, 7)}-01`;

export function monthEnd(date: BankDate): BankDate {
  return addDays(addMonths(monthStart(date), 1), -1);
}

/** Every date after `from` up to and including `to`. */
export function datesAfter(from: BankDate, to: BankDate): BankDate[] {
  const dates: BankDate[] = [];
  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** "19 Nov 2026". */
export function formatDate(date: BankDate): string {
  const value = utc(date);
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][value.getUTCMonth()];
  return `${value.getUTCDate()} ${month} ${value.getUTCFullYear()}`;
}
