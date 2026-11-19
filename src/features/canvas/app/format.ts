import type { Cell, Format } from "../domain/view";

/**
 * Number and date formatting for the App. Pure: the same Cell always prints
 * the same text, whatever the Host's locale, so a View reads alike on the
 * page and inside Claude.
 */

export type Fmt = { format?: Format; unit?: string };

const LOCALE = "en-US";
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
export const MISSING = "–";

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(key: string, options: Intl.NumberFormatOptions) {
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

/** A Cell as a finite number, or null. */
export function toNumber(cell: Cell | undefined): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell === "string" && cell.trim() !== "") {
    const parsed = Number(cell);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Decimals worth showing for a magnitude: 1,284 / 128.4 / 12.84 / 0.128. */
function decimalsFor(value: number) {
  const size = Math.abs(value);
  if (size >= 1000) return 0;
  if (size >= 100) return 1;
  if (size >= 1 || size === 0) return 2;
  return 3;
}

export function formatNumber(value: number, maxDecimals = decimalsFor(value)) {
  return numberFormat(`n${maxDecimals}`, {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/** 12.9K, 4.2M: for axes and tiles that have no room for every digit. */
export function formatCompact(value: number) {
  if (Math.abs(value) < 1000) return formatNumber(value);
  return numberFormat("compact", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

const TIME =
  /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * A date or timestamp as milliseconds, read as wall-clock time (no time zone
 * shifts): `2025-02-12`, `2025-02-12 14:00:00`, `2025-02-12T14:00:00Z`, `2025-02`.
 * A bare number under 3000 is a year; a larger one is already milliseconds.
 */
export function parseTime(cell: Cell | undefined): number | null {
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return null;
    return cell > 0 && cell < 3000 && Number.isInteger(cell)
      ? Date.UTC(cell, 0, 1)
      : cell;
  }
  if (typeof cell !== "string") return null;
  const text = cell.trim();
  if (/^\d{4}$/.test(text)) return Date.UTC(Number(text), 0, 1);
  const match = TIME.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day ?? 1),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
  );
  return Number.isFinite(ms) ? ms : null;
}

const two = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD`, the form a date Parameter takes. */
export function isoDate(ms: number) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
}

export type TimeUnit = "hour" | "day" | "month" | "year";

/** A moment in full, at the precision of its unit: for tooltips and tables. */
export function formatTime(ms: number, unit: TimeUnit = "day") {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = MONTHS[date.getUTCMonth()];
  if (unit === "year") return String(year);
  if (unit === "month") return `${month} ${year}`;
  const day = `${date.getUTCDate()} ${month} ${year}`;
  if (unit === "day") return day;
  return `${day}, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

/**
 * Axis labels for a run of ticks: each says only what changed since the tick
 * before it ("Jan 2024", "Feb", "Mar" … "Jan 2025"), so the axis stays short.
 */
export function timeTickLabels(ticks: number[], unit: TimeUnit): string[] {
  let lastYear: number | null = null;
  let lastDay: string | null = null;
  return ticks.map((ms) => {
    const date = new Date(ms);
    const year = date.getUTCFullYear();
    const month = MONTHS[date.getUTCMonth()];
    const newYear = year !== lastYear;
    lastYear = year;
    if (unit === "year") return String(year);
    if (unit === "month") return newYear ? `${month} ${year}` : month;
    const day = `${date.getUTCDate()} ${month}`;
    if (unit === "day") return newYear ? `${day} ${year}` : day;
    const newDay = day !== lastDay;
    lastDay = day;
    const time = `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
    return newDay ? `${day} ${time}` : time;
  });
}

/** The unit a column of moments is kept at, from the smallest step between them. */
export function timeUnitOf(sorted: number[]): TimeUnit {
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 0 && gap < step) step = gap;
  }
  const DAY = 86_400_000;
  if (step < DAY) return "hour";
  if (step < 28 * DAY) return "day";
  if (step < 365 * DAY) return "month";
  if (step === Number.POSITIVE_INFINITY) {
    const only = sorted[0];
    if (only === undefined) return "day";
    const date = new Date(only);
    if (date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0) return "hour";
    return "day";
  }
  return "year";
}

function withUnit(text: string, unit?: string) {
  if (!unit) return text;
  return /^[%°]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
}

/**
 * A Cell as text under a format and unit. `percent` values are percent
 * points (12.5 prints "12.5%"); `currency` is Meridian crowns ("1,250 MDC").
 */
export function formatValue(
  cell: Cell | undefined,
  { format, unit }: Fmt = {},
  options: { compact?: boolean } = {},
): string {
  if (cell === null || cell === undefined || cell === "") return MISSING;
  if (format === "text") return String(cell);
  if (format === "date" || format === "datetime") {
    const ms = parseTime(cell);
    if (ms === null) return String(cell);
    return formatTime(ms, format === "date" ? "day" : "hour");
  }
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  const value = typeof cell === "number" ? cell : toNumber(cell);
  if (value === null) return String(cell);
  if (typeof cell === "string" && !format) return cell;
  const compact = options.compact || format === "compact";
  switch (format) {
    case "integer":
      return withUnit(
        compact && Math.abs(value) >= 10_000
          ? formatCompact(value)
          : formatNumber(Math.round(value), 0),
        unit,
      );
    case "percent":
      return `${formatNumber(value, Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2)}%`;
    case "currency":
      return `${compact ? formatCompact(value) : formatNumber(value, Math.abs(value) >= 1000 ? 0 : 2)} ${unit || "MDC"}`;
    default:
      return withUnit(compact ? formatCompact(value) : formatNumber(value), unit);
  }
}

/** A signed change: "+4.2%", "−310 MW". Zero carries no sign. */
export function formatDelta(value: number, fmt: Fmt = {}) {
  const text = formatValue(Math.abs(value), fmt);
  if (value === 0) return text;
  return `${value > 0 ? "+" : "−"}${text}`;
}

/** Tick labels for a number axis: one style for the whole axis. */
export function axisTickLabels(ticks: number[], format?: Format): string[] {
  const reach = Math.max(...ticks.map((tick) => Math.abs(tick)), 0);
  const step =
    ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : Math.abs(ticks[0] ?? 1);
  const decimals = Math.max(
    0,
    Math.min(4, -Math.floor(Math.log10(step || 1) + 1e-9)),
  );
  return ticks.map((tick) => {
    const text =
      reach >= 10_000
        ? formatCompact(tick)
        : formatNumber(tick, format === "integer" ? 0 : decimals);
    return format === "percent" ? `${text}%` : text;
  });
}

/** The words a number axis is titled with: its label and, in brackets, its unit. */
export function axisTitle(axis: {
  label?: string;
  unit?: string;
  format?: Format;
  field: string;
}) {
  const unit = axis.unit || (axis.format === "currency" ? "MDC" : "");
  const label = axis.label || axis.field.replace(/_/g, " ");
  return unit && !label.includes(unit) ? `${label} (${unit})` : label;
}
