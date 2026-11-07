import "server-only";
import { createHash } from "node:crypto";
import { countRuns } from "./repository";

export const RATE_LIMITS = { perVisitorPerHour: 5, perDay: 100 };

/** Tag for runs started by the e2e suite; they skip limits and are deleted afterwards. */
export const E2E_VISITOR = "e2e";

export function hashVisitor(ip: string, salt: string) {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** Returns a message when the visitor or the whole demo is over its limit. */
export async function rateLimitMessage(visitorHash: string) {
  const now = Date.now();
  const [visitorRuns, dailyRuns] = await Promise.all([
    countRuns({ visitorHash, since: new Date(now - 60 * 60 * 1000) }),
    countRuns({ since: new Date(now - 24 * 60 * 60 * 1000) }),
  ]);
  if (visitorRuns >= RATE_LIMITS.perVisitorPerHour) {
    return `You've run ${RATE_LIMITS.perVisitorPerHour} Pre-screens in the last hour. Showing the latest stored run instead.`;
  }
  if (dailyRuns >= RATE_LIMITS.perDay) {
    return "The demo has reached today's limit of live runs. Showing the latest stored run instead.";
  }
  return null;
}
