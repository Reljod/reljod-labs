const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** A calendar date as `YYYY-MM-DD`, comparable as a string. */
export type IsoDate = string;

function iso(year: number, month: number, day: number): IsoDate | null {
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

/**
 * Parses a date as printed on a Document: `14 MAR 1991`, `02 Oct 2026` or `1991-03-14`.
 * Returns null when the text is not a single unambiguous date.
 */
export function parsePrintedDate(text: string): IsoDate | null {
  const value = text.trim();

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) {
    return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const dayMonthYear = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(
    value,
  );
  if (dayMonthYear) {
    const month = MONTHS[dayMonthYear[2].toLowerCase()];
    if (!month) return null;
    return iso(Number(dayMonthYear[3]), month, Number(dayMonthYear[1]));
  }

  return null;
}

/**
 * Parses a `YYMMDD` date from a passport's machine-readable zone. Expiry dates are
 * always this century; birth dates later than the reference year belong to the last one.
 */
export function parseMrzDate(
  text: string,
  kind: "expiry" | "birth",
  referenceDate: IsoDate,
): IsoDate | null {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const twoDigitYear = Number(match[1]);
  const referenceYear = Number(referenceDate.slice(0, 4));
  let year = 2000 + twoDigitYear;
  if (kind === "birth" && year > referenceYear) year -= 100;
  return iso(year, Number(match[2]), Number(match[3]));
}

/** The same calendar day `months` months earlier, clamped to the month's last day. */
export function subtractMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  const totalMonths = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return iso(targetYear, targetMonth, Math.min(day, lastDay)) as IsoDate;
}
