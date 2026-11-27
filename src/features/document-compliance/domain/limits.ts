/**
 * Every cap of the demo, in one place; the services apply them. A Pre-screen
 * is the only paid work (three model reads); the rest are writes a person
 * makes without spending on the model.
 */
export const LIMITS = {
  /** Pre-screens one visitor may start in an hour. */
  prescreensPerVisitorPerHour: 5,
  /** Pre-screens everyone together may start in a day. */
  prescreensPerDay: 100,
  /** Re-evaluations of one run, after the first evaluation. */
  reevaluationsPerRun: 20,
  /** Reviewer decisions on one run, every Finding together. */
  reviewsPerRun: 60,
  /** Rule saves and restores by one Owner in an hour. */
  ruleSavesPerHour: 60,
  noteMinLength: 3,
  noteMaxLength: 1000,
} as const;

/** Which Pre-screen cap refused a run: the visitor's hourly one, or the demo's daily one. */
export type RunRefusal = "visitor" | "day";

/** What a visitor is told when a cap refused their run. */
export function runLimitMessage(refusal: RunRefusal) {
  return refusal === "visitor"
    ? `You've run ${LIMITS.prescreensPerVisitorPerHour} Pre-screens in the last hour. Showing the latest stored run instead.`
    : "The demo has reached today's limit of live runs. Showing the latest stored run instead.";
}
