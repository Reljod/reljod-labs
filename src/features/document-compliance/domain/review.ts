import { LIMITS } from "./limits";
import type { RequirementId } from "./rulebook";
import type { Outcome } from "./types";

/** What a Reviewer settles a flagged Finding as. */
export type ReviewOutcome = Extract<Outcome, "pass" | "fail">;

/** A Reviewer's decision on one Finding, newest wins. */
export type ReviewView = {
  requirementId: RequirementId;
  /** The Evaluation the Finding came from when it was reviewed. */
  evaluation: number;
  /** What the Finding said when it was reviewed. */
  findingOutcome: Outcome;
  outcome: ReviewOutcome;
  note: string;
  reviewer: string;
  at: string;
};

export type ReviewInput = { outcome: unknown; note: unknown };

export type ReviewCheck =
  | { ok: true; outcome: ReviewOutcome; note: string }
  | { ok: false; message: string };

/** A decision needs an outcome and a note that says why. */
export function checkReview(input: ReviewInput): ReviewCheck {
  if (input.outcome !== "pass" && input.outcome !== "fail") {
    return { ok: false, message: "Choose Pass or Fail." };
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length < LIMITS.noteMinLength) {
    return { ok: false, message: "Say why in a short note." };
  }
  if (note.length > LIMITS.noteMaxLength) {
    return {
      ok: false,
      message: `Keep the note under ${LIMITS.noteMaxLength} characters.`,
    };
  }
  return { ok: true, outcome: input.outcome, note };
}

/** Whether a Reviewer agreed with the Finding or overrode it. */
export function reviewVerb(
  review: Pick<ReviewView, "findingOutcome" | "outcome">,
) {
  return review.findingOutcome === review.outcome ? "Confirmed" : "Overridden";
}

/** Only flagged Findings need a person. */
export const needsReviewer = (outcome: Outcome) => outcome !== "pass";

type Comparable = {
  requirementId: RequirementId;
  title: string;
  outcome: Outcome;
};

/** How one Requirement's Finding moved between two Evaluations. */
export type FindingChange = {
  requirementId: RequirementId;
  title: string;
  /** Null when the Requirement was off before. */
  from: Outcome | null;
  /** Null when the Requirement is off now. */
  to: Outcome | null;
};

/** The Findings that changed outcome, appeared or went away, in the later order. */
export function diffFindings(
  before: Comparable[],
  after: Comparable[],
): FindingChange[] {
  const previous = new Map(before.map((item) => [item.requirementId, item]));
  const changes: FindingChange[] = [];
  for (const item of after) {
    const old = previous.get(item.requirementId);
    if (old?.outcome !== item.outcome) {
      changes.push({
        requirementId: item.requirementId,
        title: item.title,
        from: old?.outcome ?? null,
        to: item.outcome,
      });
    }
    previous.delete(item.requirementId);
  }
  for (const old of previous.values()) {
    changes.push({
      requirementId: old.requirementId,
      title: old.title,
      from: old.outcome,
      to: null,
    });
  }
  return changes;
}

/** Counts per outcome, for a summary or an Audit event. */
export function countOutcomes(findings: { outcome: Outcome }[]) {
  const counts: Record<Outcome, number> = { pass: 0, fail: 0, needs_review: 0 };
  for (const finding of findings) counts[finding.outcome] += 1;
  return counts;
}
