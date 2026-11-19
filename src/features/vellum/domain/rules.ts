/**
 * Rules are data: when a Trace stops. The visitor may move them within their
 * bounds; the server checks a Pass against `LIMITS` whatever they say.
 */
import { LIMITS } from "./limits";

export type RuleId = "target" | "passes";

export type Rule = {
  id: RuleId;
  sentence: string;
  default: number;
  min: number;
  max: number;
  step: number;
  /** How the value reads on the page. */
  format: (value: number) => string;
};

export const RULES: Record<RuleId, Rule> = {
  target: {
    id: "target",
    sentence: "Stop when the Ruler measures a Likeness of at least",
    default: 0.9,
    min: 0.6,
    max: 0.98,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  passes: {
    id: "passes",
    sentence: "Or after this many Passes, whichever comes first",
    default: 3,
    min: 1,
    max: LIMITS.passesPerTrace,
    step: 1,
    format: (value) => String(value),
  },
};

export type Rulebook = Record<RuleId, number>;

export const DEFAULT_RULEBOOK: Rulebook = {
  target: RULES.target.default,
  passes: RULES.passes.default,
};

/** A Rulebook with every value inside its Rule's bounds. */
export function clampRulebook(
  input: Partial<Record<RuleId, unknown>>,
): Rulebook {
  const out = { ...DEFAULT_RULEBOOK };
  for (const rule of Object.values(RULES)) {
    const value = input[rule.id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const stepped = Math.round(value / rule.step) * rule.step;
    out[rule.id] =
      Math.round(Math.min(rule.max, Math.max(rule.min, stepped)) * 1000) / 1000;
  }
  return out;
}

/** Whether a Trace should take another Pass after a Pass that measured `likeness`. */
export function wantsAnotherPass(
  rulebook: Rulebook,
  passesTaken: number,
  likeness: number,
) {
  return likeness < rulebook.target && passesTaken < rulebook.passes;
}
