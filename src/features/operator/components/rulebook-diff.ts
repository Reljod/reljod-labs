import type { RulebookVersion } from "../domain/contract";
import {
  RULE_LIMITS,
  RULES,
  type Rulebook,
  type RuleId,
  rulebookSchema,
} from "../domain/rules";

/**
 * Pure helpers of the Rules place (rules-editor.tsx): which Rules a draft
 * changes, the first problem with it, and the next version number. No React.
 */

/** A Rule's slice of a Rulebook in a form that compares by value: lists sorted. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    Array.isArray(item) && item.every((entry) => typeof entry === "string")
      ? [...item].sort()
      : item,
  );
}

/** The Rules whose switch or Parameters differ between two Rulebooks, in `RULES` order. */
export function changedRules(base: Rulebook, draft: Rulebook): RuleId[] {
  return RULES.filter(
    (rule) => canonical(base[rule.key]) !== canonical(draft[rule.key]),
  ).map((rule) => rule.id);
}

export function sameRulebook(a: Rulebook, b: Rulebook) {
  return changedRules(a, b).length === 0;
}

/** "No change", "1 Rule changed", "3 Rules changed". */
export function diffSummary(changed: readonly RuleId[]) {
  if (changed.length === 0) return "No change from the current version";
  return `${changed.length} ${changed.length === 1 ? "Rule" : "Rules"} changed`;
}

/**
 * Adds or removes one item, keeping the canonical order of `order` so a
 * Rulebook toggled back to where it was compares equal and reads the same.
 */
export function toggleIn<T extends string>(
  list: readonly T[],
  item: T,
  order: readonly T[],
): T[] {
  const next = list.includes(item)
    ? list.filter((entry) => entry !== item)
    : [...list, item];
  return order.filter((entry) => next.includes(entry));
}

/** The first reason the draft cannot be saved, in plain words, or null. */
export function firstProblem(draft: Rulebook): string | null {
  const parsed = rulebookSchema.safeParse(draft);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  const key = issue.path[0];
  const rule = RULES.find((item) => item.key === key);
  const where = rule ? `${rule.title}: ` : "";
  if (key === "records" && issue.path[1] === "max")
    return `${where}enter a whole number from 1 to ${RULE_LIMITS.maxRecords}.`;
  return `${where}${issue.message}`;
}

/**
 * Something that saves but probably is not meant: a Screen list without the
 * main menu keeps the Operator on the sign-on Screen.
 */
export function warningOf(draft: Rulebook): string | null {
  if (draft.screens.enabled && !draft.screens.allowed.includes("HMM100"))
    return "Without HMM100 (Main menu) the Operator cannot leave the sign-on Screen, so every Run stops at the start.";
  return null;
}

/** The number the next save gets: one past the highest version there is. */
export function nextVersion(history: readonly RulebookVersion[]) {
  return history.reduce((top, item) => Math.max(top, item.version), 0) + 1;
}
