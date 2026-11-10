const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** A real calendar date in ISO form, or null. "1990-04-31" is null. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const written = trimmed.match(
    /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/,
  );
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (written) {
    year = Number(written[3]);
    month = MONTHS.indexOf(written[2].toLowerCase()) + 1;
    day = Number(written[1]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** The four-digit year in a date-ish string ("c. 1974", "1979", "11 Feb 1958"). */
export function yearOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(1[89]\d{2}|20\d{2})/);
  return match ? Number(match[1]) : null;
}

export function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Whole years from `birth` to `on`. */
export function ageOn(birth: string, on: string) {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** The due date for a contribution month: the given day of the next month. */
export function dueDate(period: string, day: number) {
  const [year, month] = period.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, day));
  return next.toISOString().slice(0, 10);
}

export function formatDate(iso: string) {
  const date = isoDate(iso);
  if (!date) return iso;
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1].replace(/^./, (c) => c.toUpperCase())} ${year}`;
}

export function formatMoney(amount: number) {
  return `CI$${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
