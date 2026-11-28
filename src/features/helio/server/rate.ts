import "server-only";
import { LimitError } from "@/platform/errors";
import { db } from "@/server/postgres";
import { LIMITS } from "../domain/limits";
import type { HelioRate, RateBucket } from "./ports";

function bucketLimits(bucket: RateBucket) {
  return bucket === "image"
    ? {
        hourLimit: LIMITS.imageCallsPerHour,
        dayLimit: LIMITS.imageCallsPerDayGlobal,
      }
    : {
        hourLimit: LIMITS.directorCallsPerHour,
        dayLimit: LIMITS.directorCallsPerDayGlobal,
      };
}

/**
 * Whether `units` more calls of one bucket fit under the visitor's hour and
 * everyone's day: the refusal to show, or null. Pure; exported for its test.
 */
export function rateRefusal(input: {
  bucket: RateBucket;
  units: number;
  visitorUsedHour: number;
  globalUsedDay: number;
}): string | null {
  const { hourLimit, dayLimit } = bucketLimits(input.bucket);
  if (input.visitorUsedHour + input.units > hourLimit)
    return `Hourly ${input.bucket} limit reached (${hourLimit}/hr). Try again in a few minutes.`;
  if (input.globalUsedDay + input.units > dayLimit)
    return "Daily studio quota reached across visitors. Please try again tomorrow.";
  return null;
}

/**
 * Helio's caps over `helio.rate_hits` (`bucket`, `units`). Not the shared
 * `pgRateLimiter`, which takes one kind per call: a Shoot spends from both
 * buckets, and every bucket must be checked inside ONE transaction before
 * any hit is inserted, so a refusal on the second never spends the first.
 * Locks are taken in a fixed order so two multi-bucket takes never deadlock.
 */
export const pgHelioRate: HelioRate = {
  async take(who, spend) {
    if (who.trusted) return;
    const ordered = (Object.entries(spend) as [RateBucket, number][])
      .map(
        ([bucket, units]) =>
          [bucket, Math.max(1, Math.min(10, Math.floor(units)))] as const,
      )
      .sort(([a], [b]) => a.localeCompare(b));
    if (ordered.length === 0) return;

    const refusal = await db().begin(async (tx) => {
      for (const [bucket] of ordered) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`helio:global:${bucket}`}, 0))`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${`helio:visitor:${who.hash}:${bucket}`}, 0))`;
      }
      // One query counts every bucket's hour and day.
      const rows = await tx<
        { bucket: RateBucket; visitor_used: number; global_used: number }[]
      >`
        select
          bucket,
          coalesce(sum(units) filter (
            where visitor_hash = ${who.hash}
              and created_at > now() - interval '1 hour'
          ), 0)::int as visitor_used,
          coalesce(sum(units), 0)::int as global_used
        from helio.rate_hits
        where bucket in ${tx(ordered.map(([bucket]) => bucket))}
          and created_at > now() - interval '24 hours'
        group by bucket`;
      const used = new Map(rows.map((row) => [row.bucket, row]));
      for (const [bucket, units] of ordered) {
        const message = rateRefusal({
          bucket,
          units,
          visitorUsedHour: used.get(bucket)?.visitor_used ?? 0,
          globalUsedDay: used.get(bucket)?.global_used ?? 0,
        });
        if (message) return message;
      }
      // Every bucket fits: record them all in the same transaction.
      await tx`insert into helio.rate_hits ${tx(
        ordered.map(([bucket, units]) => ({
          visitor_hash: who.hash,
          bucket,
          units,
        })),
      )}`;
      return null;
    });
    if (refusal) throw new LimitError(refusal);
  },
};
