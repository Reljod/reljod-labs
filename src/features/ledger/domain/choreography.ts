import type { PlanStep } from "./build-plan";
import type { ContentKind } from "./content-tree";
import { type Grip, gripFor } from "./gait";

/**
 * One beat of a Build, in the order Ledger plays them. Beats say what happens,
 * never where: the stage measures the page to place each one.
 */
export type Beat =
  | { type: "unstitch" }
  | { type: "run-to"; source: string; pace: PlanStep["pace"] }
  | { type: "rip"; source: string; excerpt: string | null; line: string }
  | { type: "haul"; grip: Grip; pace: PlanStep["pace"] }
  | { type: "stamp" }
  | { type: "toss" }
  | { type: "reform" }
  | { type: "rewind" };

/** The beats for one validated step. */
export function beatsForStep(step: PlanStep, kind: ContentKind): Beat[] {
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
  return [
    ...reach,
    { type: "haul", grip: gripFor(kind), pace: step.pace },
    { type: "stamp" },
  ];
}

/**
 * Opens a Build: the first one in an Ask session tears the full page apart,
 * a follow-up rewinds the previous answer back into the page first.
 */
export function openingBeats(isFollowUp: boolean): Beat[] {
  return isFollowUp ? [{ type: "rewind" }] : [{ type: "unstitch" }];
}

/** Closes a Build: Reform only when something was placed on the board. */
export function closingBeats(placed: number): Beat[] {
  return placed > 0 ? [{ type: "reform" }] : [];
}
