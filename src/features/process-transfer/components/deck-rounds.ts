import type { Deck } from "../domain/deck";
import { blocking, type Rule } from "../domain/rules";
import type { Approval, DeckRound } from "../domain/run";
import { plural } from "./format";

/*
 * What the Deck tab says about each Round: how many Checks failed and why,
 * and where a failure points in the Deck.
 */

export const ROUND_BY: Record<DeckRound["by"], string> = {
  draft: "First draft",
  revision: "Model revision",
  "auto-fit": "Fit by rule",
};

export type RoundStats = {
  blocking: number;
  warnings: number;
  major: number;
  minor: number;
  checks: number;
  passedChecks: number;
};

export function roundStats(
  round: Pick<DeckRound, "checks" | "findings">,
): RoundStats {
  const failed = round.checks.filter((check) => !check.passed);
  return {
    blocking: blocking(round.checks).length,
    warnings: failed.filter((check) => check.severity === "warn").length,
    major: round.findings.filter((item) => item.severity === "major").length,
    minor: round.findings.filter((item) => item.severity === "minor").length,
    checks: round.checks.length,
    passedChecks: round.checks.length - failed.length,
  };
}

/** "Round 1 · 3 failed", "Round 3 · passed". */
export function roundLabel(
  round: Pick<DeckRound, "round" | "passed" | "checks" | "findings">,
): string {
  if (round.passed) return `Round ${round.round} · passed`;
  if (round.checks.length === 0) return `Round ${round.round} · no Checks`;
  const stats = roundStats(round);
  const failed = stats.blocking + stats.major;
  return failed > 0
    ? `Round ${round.round} · ${failed} failed`
    : `Round ${round.round} · ${plural(stats.warnings, "warning")}`;
}

/** The slide a failure or Finding points at (`p3` is a Deck plan id), or null. */
export function slideIndexFor(
  deck: Pick<Deck, "slides">,
  target: string | null,
): number | null {
  if (!target) return null;
  const index = deck.slides.findIndex(
    (slide) => slide.planId === target || slide.id === target,
  );
  return index === -1 ? null : index;
}

/** "Slide 4" for a plan id, or the raw target if it names no slide. */
export function slideName(
  deck: Pick<Deck, "slides">,
  target: string | null,
): string | null {
  const index = slideIndexFor(deck, target);
  if (index !== null) return `Slide ${index + 1}`;
  return target;
}

/** The Rule limit on Rounds the Run used. */
export function maxRounds(rules: Rule[]): number | null {
  const rule = rules.find((item) => item.id === "loop.max-rounds");
  const value = rule?.params.rounds;
  return typeof value === "number" ? value : null;
}

/** What changed from one Round to the next, by failing Rule. */
export type RoundDiff = {
  /** Failed before, pass now. */
  fixed: string[];
  /** Still failing. */
  still: string[];
  /** Pass before (or absent), fail now. */
  fresh: string[];
};

export function roundDiff(
  previous: Pick<DeckRound, "checks"> | null,
  current: Pick<DeckRound, "checks">,
): RoundDiff {
  const failing = (round: Pick<DeckRound, "checks"> | null) =>
    new Set(
      (round?.checks ?? [])
        .filter((check) => !check.passed)
        .map((check) => check.ruleId),
    );
  const before = failing(previous);
  const now = failing(current);
  return {
    fixed: [...before].filter((id) => !now.has(id)),
    still: [...now].filter((id) => before.has(id)),
    fresh: [...now].filter((id) => !before.has(id)),
  };
}

/** What a Redo throws away, to confirm first; null when there is nothing to lose. */
export function redoWarning(
  approval: Pick<Approval, "status" | "round"> | null,
): string | null {
  if (!approval) return null;
  return approval.status === "approved"
    ? `This replaces the approved Deck of Round ${approval.round} and calls the models again.`
    : "This replaces the Rounds of this Run and calls the models again.";
}

/** The one-line verdict on a first Round, in words. */
export function firstRoundLine(
  round: Pick<DeckRound, "passed" | "checks" | "findings">,
  title: (ruleId: string) => string,
): string {
  const failing = round.checks.filter((check) => !check.passed);
  if (round.checks.length === 0) {
    return round.passed
      ? "No Deck Rules were on, so nothing was measured."
      : "No Deck Rules were on for this Round, so nothing could approve it.";
  }
  if (failing.length === 0 && round.passed)
    return "It passed every Rule on the first try.";
  if (failing.length > 0)
    return `${plural(failing.length, "Rule")} failed: ${failing.map((check) => title(check.ruleId)).join(", ")}.`;
  if (round.findings.some((item) => item.severity === "major"))
    return "The reviewer raised a major Finding.";
  return "Every Rule passed, but the Round was not approved.";
}

/**
 * The heading of a Round's Checks: null when there are Checks (the caller
 * counts them), else why there are none.
 */
export function emptyChecksLine(
  checks: unknown[],
  over: boolean,
): string | null {
  if (checks.length > 0) return null;
  return over ? "No Deck Rules were on for this Round." : "Checking…";
}
