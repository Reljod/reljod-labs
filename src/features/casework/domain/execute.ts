import { describeWant, JOBS, type JobId, unmet } from "./jobs";
import { checkCensus, reconcile } from "./rules/contributions";
import { decide, rateRisk } from "./rules/decision";
import { verifyEntity } from "./rules/entity";
import { matchIdentity } from "./rules/identity";
import { mapOwnership } from "./rules/ownership";
import { adjudicate, screen, type WatchlistEntry } from "./rules/screening";
import type { JobOutcome } from "./rules/types";
import { checkEligibility, verifyPayee } from "./rules/withdrawal";
import { type RunState, withChecks } from "./run-state";

/** Jobs that run on rules alone. The rest (sort, read) need the model. */
export const RULE_JOBS = {
  match_identity: matchIdentity,
  check_eligibility: checkEligibility,
  verify_payee: verifyPayee,
  verify_entity: verifyEntity,
  check_census: checkCensus,
  reconcile,
  map_ownership: mapOwnership,
  rate_risk: rateRisk,
  decide,
} satisfies Partial<Record<JobId, (state: RunState) => JobOutcome>>;

export function isRuleJob(
  job: JobId,
): job is keyof typeof RULE_JOBS | "screen" | "adjudicate" {
  return job in RULE_JOBS || job === "screen" || job === "adjudicate";
}

/** Runs one rule-based Job and folds its outcome into the state. */
export function applyRuleJob(
  state: RunState,
  job: JobId,
  watchlist: WatchlistEntry[],
): { state: RunState; outcome: JobOutcome } {
  const outcome =
    job === "screen"
      ? screen(state, watchlist)
      : job === "adjudicate"
        ? adjudicate(state, watchlist)
        : RULE_JOBS[job as keyof typeof RULE_JOBS](state);
  const next = withChecks({ ...state, ...outcome.patch }, outcome.checks);
  return { state: next, outcome };
}

/**
 * Runs Jobs over already-read Documents with no human to ask: unmet needs
 * become gaps, as if the person had said "carry on without it". Used by the
 * golden tests against the Cabinet's labels.
 */
export function simulate(
  state: RunState,
  jobs: JobId[],
  watchlist: WatchlistEntry[],
) {
  let current = state;
  for (const job of jobs) {
    if (job === "sort" || job === "read") continue;
    const missing = unmet(current, JOBS[job].needs(current));
    if (missing.length > 0) {
      current = {
        ...current,
        gaps: [
          ...current.gaps,
          ...missing.map((item) => ({
            job,
            wants: describeWant(item).toLowerCase(),
          })),
        ],
      };
    }
    const { state: next, outcome } = applyRuleJob(current, job, watchlist);
    current = next;
    if (outcome.question) {
      current = {
        ...current,
        gaps: [
          ...current.gaps,
          {
            job,
            wants: outcome.question.kinds.join(" or ").replaceAll("_", " "),
          },
        ],
      };
    }
  }
  return current;
}
