import type { RuleState } from "../../domain/rules";

/**
 * A Run applies the Version in force on its date (the bank's day), not the
 * latest one. These helpers say so in words, so the Rules editor never lets
 * anyone think a future-dated edit already applies.
 */

export type ScheduleKind =
  | "in-force"
  | "over-version"
  | "over-default"
  | "not-yet";

export type Schedule = { kind: ScheduleKind; text: string | null };

/**
 * What these helpers read of a Rule card: its latest saved state and the
 * Version in force today (`RuleView` carries the whole in-force state; only
 * its Version and date are needed here).
 */
type ScheduleView = {
  state: Pick<RuleState, "version" | "effectiveFrom">;
  inForce: Pick<RuleState, "version" | "effectiveFrom"> | null;
};

/** What Runs use until the scheduled change takes effect. */
function untilThen(inForce: ScheduleView["inForce"]): {
  kind: Exclude<ScheduleKind, "in-force">;
  tail: string;
} {
  if (inForce === null) {
    return { kind: "not-yet", tail: "this Rule is not in force yet" };
  }
  if (inForce.version === 0) {
    return { kind: "over-default", tail: "Runs use the Default" };
  }
  return {
    kind: "over-version",
    tail: `Runs use Version ${inForce.version}`,
  };
}

/** The saved Rule: scheduled when the latest Version is not the one in force. */
export function savedSchedule(view: ScheduleView): Schedule {
  const { state, inForce } = view;
  if (inForce !== null && inForce.version === state.version) {
    return { kind: "in-force", text: null };
  }
  const until = untilThen(inForce);
  return {
    kind: until.kind,
    text: `Scheduled: Version ${state.version} takes effect on ${state.effectiveFrom}. Until then ${until.tail}.`,
  };
}

/**
 * A live hint for an unsaved effective date: null unless the date is after
 * `today` (`YYYY-MM-DD`, the bank's day). The edit would become the next
 * Version.
 */
export function draftSchedule(
  view: ScheduleView,
  effectiveFrom: string,
  today: string,
): Schedule {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || effectiveFrom <= today) {
    return { kind: "in-force", text: null };
  }
  // The edit would sit over whatever is in force today (the latest Version
  // is itself not in force when it is scheduled).
  const until = untilThen(view.inForce);
  return {
    kind: until.kind,
    text: `Scheduled: this edit (Version ${view.state.version + 1}) takes effect on ${effectiveFrom}. Until then ${until.tail}.`,
  };
}

/** How many of these Rules are scheduled behind a Version in force. */
export function scheduledCount(rules: readonly ScheduleView[]): number {
  return rules.filter((rule) => savedSchedule(rule).kind !== "in-force").length;
}
