import type { PlanStep } from "./build-plan";

/**
 * One beat of a Build, in the order Ledger plays them. Beats say what happens,
 * never where: the stage measures the page to place each one.
 */
export type Beat =
  | { type: "unstitch" }
  | { type: "run-to"; source: string; pace: PlanStep["pace"] }
  | { type: "rip"; source: string; excerpt: string | null; line: string }
  | { type: "push"; pace: PlanStep["pace"] }
  | { type: "stack" }
  | { type: "toss" }
  | { type: "kick" }
  | { type: "write" }
  | { type: "rewind" };

/** The beats for one validated step. */
export function beatsForStep(step: PlanStep): Beat[] {
  const reach: Beat[] = [
    { type: "run-to", source: step.source, pace: step.pace },
    {
      type: "rip",
      source: step.source,
      excerpt: step.excerpt,
      line: step.line,
    },
  ];
  if (step.action === "toss") return [...reach, { type: "toss" }];
  return [...reach, { type: "push", pace: step.pace }, { type: "stack" }];
}

/**
 * Opens a Build: the first one in an Ask session tears the full page apart,
 * a follow-up rewinds the previous answer back into the page first.
 */
export function openingBeats(isFollowUp: boolean): Beat[] {
  return isFollowUp ? [{ type: "rewind" }] : [{ type: "unstitch" }];
}

/**
 * Closes a Build: with blocks on the Stack, the rest of the page is kicked
 * away and the Stack is written up; with none, nothing is.
 */
export function closingBeats(stacked: number): Beat[] {
  return stacked > 0 ? [{ type: "kick" }, { type: "write" }] : [];
}
