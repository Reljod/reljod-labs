import "server-only";
import { countBuilds } from "./repository";
import type { Visitor } from "./visitor";

export const RATE_LIMITS = { perVisitorPerHour: 10, perDay: 300 };

/** Returns a message when the visitor or the whole site is over its limit. */
export async function rateLimitMessage(visitor: Visitor) {
  if (visitor.forceLimit) return limitMessages.visitor;
  if (!visitor.limited) return null;
  const now = Date.now();
  const [visitorBuilds, dailyBuilds] = await Promise.all([
    countBuilds({
      visitorHash: visitor.hash,
      since: new Date(now - 60 * 60 * 1000),
    }),
    countBuilds({ since: new Date(now - 24 * 60 * 60 * 1000) }),
  ]);
  if (visitorBuilds >= RATE_LIMITS.perVisitorPerHour)
    return limitMessages.visitor;
  if (dailyBuilds >= RATE_LIMITS.perDay) return limitMessages.site;
  return null;
}

const limitMessages = {
  visitor: `Ledger has answered ${RATE_LIMITS.perVisitorPerHour} of your questions this hour and needs a nap. Here's a recent answer instead.`,
  site: "Ledger has hit today's question limit. Here's a recent answer instead.",
};
