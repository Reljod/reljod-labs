import { createHmac } from "node:crypto";
import { LIMITS } from "../domain/limits";

export type RateBucket = "image" | "director";

type Entry = {
  ts: number;
  units: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const visitorHits = new Map<string, Entry[]>();
const globalHits: Record<RateBucket, Entry[]> = {
  image: [],
  director: [],
};

function prune(list: Entry[], cutoff: number): Entry[] {
  let i = 0;
  while (i < list.length && list[i].ts < cutoff) i++;
  return i > 0 ? list.slice(i) : list;
}

function sumUnits(list: Entry[]): number {
  let total = 0;
  for (const item of list) total += item.units;
  return total;
}

export function hashVisitor(rawId: string, salt: string): string {
  return createHmac("sha256", salt).update(rawId).digest("hex").slice(0, 24);
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 60) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Enforces both per-visitor hourly caps and global 24-hour caps BEFORE any
 * paid model call runs. Counts `units` (e.g. 3 for a 3-market shoot).
 */
export function takeRate(input: {
  visitorKey: string;
  bucket: RateBucket;
  units?: number;
  now?: number;
}): { remainingHourly: number; remainingDailyGlobal: number } {
  const units = Math.max(1, Math.floor(input.units ?? 1));
  const now = input.now ?? Date.now();
  const hourLimit =
    input.bucket === "image"
      ? LIMITS.imageCallsPerHour
      : LIMITS.directorCallsPerHour;
  const dayLimit =
    input.bucket === "image"
      ? LIMITS.imageCallsPerDayGlobal
      : LIMITS.directorCallsPerDayGlobal;

  const key = `${input.bucket}:${input.visitorKey}`;
  const currentVisitor = prune(visitorHits.get(key) ?? [], now - HOUR_MS);
  const currentGlobal = prune(globalHits[input.bucket], now - DAY_MS);

  const visitorUsed = sumUnits(currentVisitor);
  const globalUsed = sumUnits(currentGlobal);

  if (visitorUsed + units > hourLimit) {
    const oldest = currentVisitor[0]?.ts ?? now;
    const retryAfterSeconds = Math.max(
      15,
      Math.ceil((oldest + HOUR_MS - now) / 1000),
    );
    throw new RateLimitError(
      `Hourly ${input.bucket} limit reached (${hourLimit}/hr). Try again in a few minutes.`,
      retryAfterSeconds,
    );
  }
  if (globalUsed + units > dayLimit) {
    throw new RateLimitError(
      "Daily studio quota reached across visitors. Please try again tomorrow.",
      300,
    );
  }

  currentVisitor.push({ ts: now, units });
  currentGlobal.push({ ts: now, units });
  visitorHits.set(key, currentVisitor);
  globalHits[input.bucket] = currentGlobal;

  return {
    remainingHourly: Math.max(0, hourLimit - (visitorUsed + units)),
    remainingDailyGlobal: Math.max(0, dayLimit - (globalUsed + units)),
  };
}

/** Test helper to reset in-memory buckets cleanly. */
export function _resetRateBucketsForTests() {
  visitorHits.clear();
  globalHits.image = [];
  globalHits.director = [];
}
