const MONTHS = [
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
];

/** A month as one number (year * 12 + month), so spans subtract. */
function month(text: string, now: Date): number | null {
  if (/present/i.test(text)) return now.getFullYear() * 12 + now.getMonth();
  const found = /([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(text);
  if (!found) return null;
  const index = MONTHS.indexOf(found[1]);
  if (index < 0) return null;
  return Number(found[2]) * 12 + index;
}

export type Span = {
  /** First month, as year * 12 + month. */
  start: number;
  /** The month after the last one, so a one-month job has length 1. */
  end: number;
};

/**
 * A job's period ("Mar 2022 – Apr 2025", "Jul 2026 – Present") as months.
 * Null when the period does not read as two months.
 */
export function periodSpan(period: string, now: Date): Span | null {
  const [from, to] = period.split(/\s*[–—-]\s*/);
  if (!from || !to) return null;
  const start = month(from, now);
  const last = month(to, now);
  if (start === null || last === null || last < start) return null;
  return { start, end: last + 1 };
}

export type RulerJob = { index: number; left: number; width: number };

export type Ruler = {
  /** Each job's place on the ruler, as fractions of its width (0..1). */
  jobs: RulerJob[];
  /** Every New Year on the ruler: its year and where it falls (0..1). */
  years: { year: number; at: number }[];
};

/**
 * Lays the jobs out along one ruler from the first month to the last. A job
 * whose period does not parse is left off the ruler, never guessed.
 */
export function careerRuler(periods: string[], now: Date): Ruler {
  const spans = periods
    .map((period, index) => ({ index, span: periodSpan(period, now) }))
    .filter((job): job is { index: number; span: Span } => job.span !== null);
  if (spans.length === 0) return { jobs: [], years: [] };
  const first = Math.min(...spans.map((job) => job.span.start));
  const last = Math.max(...spans.map((job) => job.span.end));
  const length = last - first;
  const jobs = spans.map(({ index, span }) => ({
    index,
    left: (span.start - first) / length,
    width: (span.end - span.start) / length,
  }));
  const years: Ruler["years"] = [];
  for (let year = Math.ceil(first / 12); year * 12 <= last; year += 1) {
    years.push({ year, at: (year * 12 - first) / length });
  }
  return { jobs, years };
}
