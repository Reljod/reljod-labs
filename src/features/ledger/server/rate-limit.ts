import "server-only";
import type { Visitor } from "@/platform/request/visitor";
import { db } from "@/server/postgres";
import { LIMITS, type LimitHit } from "../domain/limits";
import type { BuildRate } from "./ports";

/**
 * Asks `ledger.take_rate_hit` whether the visitor and the site are under
 * their caps. With `take`, it also records a hit in the same call, under an
 * advisory lock, so parallel requests cannot all take the last place. Not the
 * shared `pgRateLimiter`: `ledger.rate_hits` has no kind column, and this one
 * SQL function already counts and takes under its lock.
 */
async function check(
  visitor: Visitor,
  take: boolean,
): Promise<LimitHit | null> {
  if (visitor.trusted) return null;
  try {
    const [row] = await db()<{ refusal: string | null }[]>`
      select ledger.take_rate_hit(
        p_visitor_hash => ${visitor.hash}::text,
        p_per_hour => ${LIMITS.buildsPerVisitorPerHour}::integer,
        p_per_day => ${LIMITS.buildsPerDay}::integer,
        p_take => ${take}::boolean
      ) as refusal`;
    const refusal = row?.refusal ?? null;
    // Anything it does not recognise refuses, so a surprise never spends.
    return refusal === null ? null : refusal === "site" ? "site" : "visitor";
  } catch (error) {
    throw new Error(
      `Could not check the rate limit: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export const buildRate: BuildRate = {
  take: (visitor) => check(visitor, true),
  peek: (visitor) => check(visitor, false),
};
