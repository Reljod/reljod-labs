import "server-only";
import { LIMITS, limitMessage } from "../domain/limits";
import { sql } from "./db";
import type { Visitor } from "./visitor";

/**
 * Asks `ledger.take_rate_hit` whether the visitor and the site are under
 * their caps. With `take`, it also records a hit in the same transaction,
 * under an advisory lock, so parallel requests cannot all take the last place.
 * Returns the refusal message, or null.
 */
async function checkRate(visitor: Visitor, take: boolean) {
  if (visitor.forceLimit) return limitMessage("visitor");
  if (!visitor.limited) return null;
  try {
    const [row] = await sql()<{ refusal: string | null }[]>`
      select ledger.take_rate_hit(
        p_visitor_hash => ${visitor.hash}::text,
        p_per_hour => ${LIMITS.buildsPerVisitorPerHour}::integer,
        p_per_day => ${LIMITS.buildsPerDay}::integer,
        p_take => ${take}::boolean
      ) as refusal`;
    return limitMessage(row?.refusal);
  } catch (error) {
    throw new Error(
      `Could not check the rate limit: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Takes one Build from the visitor's hourly and the site's daily allowance,
 * before the model is called: a client that disconnects mid-stream, or posts
 * many Builds at once, still pays for each. Returns a message when over.
 */
export function takeBuildRate(visitor: Visitor) {
  return checkRate(visitor, true);
}

/** Whether a new Ask session would be refused, without spending a hit. */
export function rateLimitMessage(visitor: Visitor) {
  return checkRate(visitor, false);
}
