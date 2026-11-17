const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_NAMES = MONTHS.join("|");
const DATE = String.raw`(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_NAMES})\s+(\d{4}))`;
const LABELLED = new RegExp(
  String.raw`\b(?:date|dated|edition of|effective|as at|as of|issued)\b\s*:?\s*${DATE}`,
  "i",
);
const ANY = new RegExp(String.raw`\b${DATE}`, "i");

function iso(year: number, month: number, day: number): string | null {
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

function fromMatch(match: RegExpExecArray | null): string | null {
  if (!match) return null;
  if (match[1])
    return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  const month = MONTHS.indexOf((match[5] ?? "").toLowerCase()) + 1;
  return iso(Number(match[6]), month, Number(match[4]));
}

/**
 * The date a document carries (`YYYY-MM-DD`), read from its first lines: a
 * labelled date ("Date: 1 December 2023", "edition of 1 March 2023") first,
 * then the first date of any kind. Null when there is none. Decides which of
 * two Passages is the newer, so it reads only the head, where a document
 * dates itself, and never a date deep in the body.
 */
export function findDocumentDate(text: string): string | null {
  const head = text.slice(0, 1500);
  return (
    fromMatch(LABELLED.exec(head)) ?? fromMatch(ANY.exec(head.slice(0, 600)))
  );
}

/** `YYYY-MM-DD` as a person reads it: `1 Dec 2023`. */
export function formatDocumentDate(value: string | null): string {
  if (!value) return "undated";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${(MONTHS[month - 1] ?? "").slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${year}`;
}
