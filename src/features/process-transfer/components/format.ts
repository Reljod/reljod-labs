/*
 * How numbers, times and names read on the page. One place, so a cost or a
 * duration looks the same in the header, the Stage rail and the Cost table.
 */

/** A model call's cost: four decimals under a dollar ("$0.0421"), two above. */
export function usd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`;
}

/** A budget figure, to the cent ("$0.04 of $1.50"); a non-zero amount under a cent is "<$0.01". */
export function usdCents(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.005) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** How long something took: "420 ms", "4.2 s", "1 m 12 s". */
export function elapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0)
    return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return seconds(ms / 1000);
}

/** A length of time in whole seconds: "42 s", "1 m 12 s", "10 m". */
export function seconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  const whole = Math.round(value);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes} m` : `${minutes} m ${rest} s`;
}

/** File sizes: "820 KB", "3.2 MB". */
export function bytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const integer = new Intl.NumberFormat("en-GB");

/** Token counts with thousands separators: "12,345". */
export function count(value: number): string {
  return integer.format(Math.round(value));
}

/** "1 step", "3 steps". */
export function plural(value: number, one: string, many = `${one}s`): string {
  return `${value} ${value === 1 ? one : many}`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const timeOnly = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** "17 Nov, 14:05" in the reader's time zone. */
export function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

/** "14:05:09", for log lines. Accepts an ISO string or epoch milliseconds. */
export function clockTime(at: string | number): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "—" : timeOnly.format(date);
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

/** A safe file name from a title: lower case, ASCII, dashes, at most 60 characters. */
export function fileSlug(title: string, fallback = "handover"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || fallback;
}
