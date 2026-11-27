/** Caps on paid work: Builds per visitor per hour, and Builds site-wide per day. */
export const LIMITS = { buildsPerVisitorPerHour: 10, buildsPerDay: 300 };

/** Which cap a Build ran into, as `ledger.take_rate_hit` reports it. */
export type LimitHit = "visitor" | "site";

const messages: Record<LimitHit, string> = {
  visitor: `Ledger has answered ${LIMITS.buildsPerVisitorPerHour} of your questions this hour and needs a nap. Here's a recent answer instead.`,
  site: "Ledger has hit today's question limit. Here's a recent answer instead.",
};

/**
 * The message for what the database said: null when the Build may run.
 * Anything it does not recognise refuses, so a surprise never spends.
 */
export function limitMessage(hit: unknown): string | null {
  if (hit === null || hit === undefined) return null;
  if (hit === "visitor" || hit === "site") return messages[hit];
  return messages.visitor;
}
