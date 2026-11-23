/**
 * The Rules a response is judged by are data in each Scenario (`by` a
 * deadline, `before` another step, `never`). This is the code that checks
 * them against a drill's state. Only this file decides whether a Rule was
 * met; the Room may talk about a missed deadline, it cannot cause one.
 */
import type { DrillState } from "./engine";
import type { Rule, Scenario } from "./scenario";

export type FindingStatus = "met" | "open" | "missed" | "broken";

export type Finding = {
  rule: string;
  kind: Rule["kind"];
  text: string;
  source: string;
  status: FindingStatus;
  /** One line on why, written by code. */
  note: string;
  /** The hour that decided it, when there is one. */
  at: number | null;
};

const labelOf = (scenario: Scenario, id: string) =>
  scenario.levers.find((lever) => lever.id === id)?.label ?? id;

/** When the earliest of `ids` was pulled, or null. */
function firstTaken(state: DrillState, ids: string[]): number | null {
  const hours = ids
    .map((id) => state.taken[id])
    .filter((hour): hour is number => hour !== undefined);
  return hours.length ? Math.min(...hours) : null;
}

/**
 * Checks every Rule. Before the drill is over a deadline still ahead is
 * `open`; once the clock has passed it (or the drill ends) it is `missed`.
 */
export function checkRules(scenario: Scenario, state: DrillState): Finding[] {
  return scenario.rules.map((rule): Finding => {
    const base = {
      rule: rule.id,
      kind: rule.kind,
      text: rule.text,
      source: rule.source,
    };
    if (rule.kind === "by") {
      const at = firstTaken(state, rule.anyOf);
      if (at !== null && at <= rule.hour)
        return { ...base, status: "met", at, note: `Done at T+${at}h.` };
      if (at !== null)
        return {
          ...base,
          status: "missed",
          at,
          note: `Done at T+${at}h, ${at - rule.hour}h after the deadline.`,
        };
      if (state.done || state.hour > rule.hour)
        return {
          ...base,
          status: "missed",
          at: null,
          note: `Never done; the deadline was T+${rule.hour}h.`,
        };
      return {
        ...base,
        status: "open",
        at: null,
        note: `Due by T+${rule.hour}h.`,
      };
    }
    const at = state.taken[rule.lever];
    if (rule.kind === "never") {
      if (at !== undefined)
        return {
          ...base,
          status: "broken",
          at,
          note: `${labelOf(scenario, rule.lever)} at T+${at}h.`,
        };
      return {
        ...base,
        status: state.done ? "met" : "open",
        at: null,
        note: state.done ? "Kept throughout." : "Kept so far.",
      };
    }
    if (at === undefined)
      return {
        ...base,
        status: state.done ? "met" : "open",
        at: null,
        note: state.done
          ? `${labelOf(scenario, rule.lever)} was never done.`
          : "Not tested yet.",
      };
    const missing = rule.first.filter(
      (id) => state.taken[id] === undefined || state.taken[id] > at,
    );
    if (missing.length === 0)
      return {
        ...base,
        status: "met",
        at,
        note: "Done in the right order.",
      };
    return {
      ...base,
      status: "broken",
      at,
      note: `${labelOf(scenario, rule.lever)} at T+${at}h before: ${missing
        .map((id) => labelOf(scenario, id))
        .join(", ")}.`,
    };
  });
}

/** Rules whose deadline falls on the clock, for the dial. */
export function deadlines(scenario: Scenario) {
  return scenario.rules.flatMap((rule) =>
    rule.kind === "by"
      ? [{ id: rule.id, hour: rule.hour, text: rule.text }]
      : [],
  );
}
