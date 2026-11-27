import "server-only";
import { headers } from "next/headers";
import { isE2eToken } from "@/features/access/server/e2e";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { E2E_HEADER } from "@/platform/request/headers";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";

export type RateBucket = "image" | "director";

export type RateTake = {
  bucket: RateBucket;
  units: number;
};

/** Visitors tagged this way (the e2e suite) skip rate limits. */
export const TRUSTED_VISITOR = "e2e";

/** Who is spending: a salted hash of the client IP, never an Owner (AGENTS.md). */
export type Visitor = { hash: string; trusted: boolean };

/** Resolves the visitor hash from request headers, matching Harness and Canvas. */
export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  if (isE2eToken(requestHeaders.get(E2E_HEADER))) {
    return { hash: TRUSTED_VISITOR, trusted: true };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 60) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function bucketLimits(bucket: RateBucket): {
  hourLimit: number;
  dayLimit: number;
} {
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
 * Pure quota check used inside the Postgres advisory-locked transaction (and
 * directly by unit tests). Returns an error message when over cap, else null.
 */
export function evaluateRateBudget(input: {
  bucket: RateBucket;
  units: number;
  visitorUsedHour: number;
  globalUsedDay: number;
}): { ok: true } | { ok: false; message: string; retryAfterSeconds: number } {
  const { hourLimit, dayLimit } = bucketLimits(input.bucket);
  if (input.visitorUsedHour + input.units > hourLimit) {
    return {
      ok: false,
      message: `Hourly ${input.bucket} limit reached (${hourLimit}/hr). Try again in a few minutes.`,
      retryAfterSeconds: 120,
    };
  }
  if (input.globalUsedDay + input.units > dayLimit) {
    return {
      ok: false,
      message:
        "Daily studio quota reached across visitors. Please try again tomorrow.",
      retryAfterSeconds: 300,
    };
  }
  return { ok: true };
}

/**
 * Atomically checks and records one or more rate buckets in Postgres under
 * deterministically ordered transaction-scoped advisory locks (`helio.rate_hits`).
 * If ANY bucket is over its hourly per-visitor or 24-hour global ceiling,
 * NOTHING is inserted and `RateLimitError` is thrown.
 */
export async function takeRates(
  who: Visitor,
  takes: readonly RateTake[],
): Promise<void> {
  if (who.trusted || takes.length === 0) return;

  // Coalesce duplicate buckets and sort deterministically so concurrent
  // multi-bucket transactions always acquire advisory locks in the same order.
  const merged = new Map<RateBucket, number>();
  for (const item of takes) {
    const units = Math.max(1, Math.min(10, Math.floor(item.units)));
    merged.set(item.bucket, (merged.get(item.bucket) ?? 0) + units);
  }
  const ordered = [...merged.entries()].sort(([a], [b]) => a.localeCompare(b));

  await sql().begin(async (tx) => {
    for (const [bucket] of ordered) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`helio:global:${bucket}`}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`helio:visitor:${who.hash}:${bucket}`}, 0))`;
    }

    // 1. Check EVERY requested bucket before inserting any row.
    for (const [bucket, units] of ordered) {
      const [counts] = await tx<
        { visitor_used: number; global_used: number }[]
      >`
        select
          coalesce(sum(units) filter (
            where visitor_hash = ${who.hash}
              and created_at > now() - interval '1 hour'
          ), 0)::int as visitor_used,
          coalesce(sum(units) filter (
            where created_at > now() - interval '24 hours'
          ), 0)::int as global_used
        from helio.rate_hits
        where bucket = ${bucket}
          and created_at > now() - interval '24 hours'`;

      const decision = evaluateRateBudget({
        bucket,
        units,
        visitorUsedHour: counts?.visitor_used ?? 0,
        globalUsedDay: counts?.global_used ?? 0,
      });
      if (!decision.ok) {
        throw new RateLimitError(decision.message, decision.retryAfterSeconds);
      }
    }

    // 2. All buckets fit: commit every hit atomically inside the same transaction.
    for (const [bucket, units] of ordered) {
      await tx`
        insert into helio.rate_hits (visitor_hash, bucket, units)
        values (${who.hash}, ${bucket}, ${units})`;
    }
  });
}

/** Convenience wrapper for taking a single bucket. */
export async function takeRate(
  who: Visitor,
  bucket: RateBucket,
  units = 1,
): Promise<void> {
  await takeRates(who, [{ bucket, units }]);
}
