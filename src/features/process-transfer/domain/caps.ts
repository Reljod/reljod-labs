import { LIMITS } from "./limits";
import type { Spend } from "./run";

/*
 * The caps on paid work, as arithmetic over counts the server reads. Every
 * entry point that adds model calls (a new Run, a Redo) goes through
 * `workProblem`, so the numbers are applied in one place.
 */

export type WorkCounts = {
  /** Runs and Redos this visitor started in the last hour. */
  visitorStartsLastHour: number;
  /** Runs and Redos the whole demo started in the last day. */
  startsToday: number;
  /** USD this Owner's model calls cost in the last day. */
  ownerSpentToday: number;
  /** The Owner's Run that is still going, if any. */
  activeRunId: string | null;
};

/** Why new paid work is refused now, or null. The e2e suite skips the rate and spend caps. */
export function workProblem(
  counts: WorkCounts,
  options: { trusted: boolean },
): string | null {
  if (counts.activeRunId) {
    return "A Run is still going. Stop it or let it finish before starting another.";
  }
  if (options.trusted) return null;
  if (counts.ownerSpentToday >= LIMITS.spendPerOwnerPerDay) {
    return `Your Runs have cost $${counts.ownerSpentToday.toFixed(2)} today, the demo's daily cap of $${LIMITS.spendPerOwnerPerDay.toFixed(2)}. Try again tomorrow.`;
  }
  if (counts.visitorStartsLastHour >= LIMITS.runsPerVisitorPerHour) {
    return `That's ${LIMITS.runsPerVisitorPerHour} Runs this hour. Try again in a little while.`;
  }
  if (counts.startsToday >= LIMITS.runsPerDay) {
    return "The demo has reached today's limit of Runs. Try again tomorrow.";
  }
  return null;
}

/** Why a Redo of this Run is refused, or null (before the shared caps). */
export function redoProblem(run: {
  status: string;
  hasProcess: boolean;
  /** The Verify stage finished: the Process was checked. */
  verified: boolean;
  redos: number;
}): string | null {
  if (run.status === "queued" || run.status === "running") {
    return "The Run is still going.";
  }
  if (!run.hasProcess) {
    return "This Run has no Process to make a Deck from.";
  }
  if (!run.verified) {
    return "This Run stopped before its Process was verified; start a new Run.";
  }
  if (run.redos >= LIMITS.redosPerRun) {
    return `A Run's Deck may be redone ${LIMITS.redosPerRun} times; start a new Run instead.`;
  }
  return null;
}

export function spendView(
  counts: Pick<WorkCounts, "ownerSpentToday" | "visitorStartsLastHour">,
): Spend {
  return {
    todayUsd: Number(counts.ownerSpentToday.toFixed(4)),
    capUsd: LIMITS.spendPerOwnerPerDay,
    runsLeftThisHour: Math.max(
      0,
      LIMITS.runsPerVisitorPerHour - counts.visitorStartsLastHour,
    ),
  };
}
