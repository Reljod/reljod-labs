import {
  LOCKED_ON,
  type ParamDef,
  RULES,
  type Rule,
  type RuleDef,
  type RuleOverride,
  type Severity,
} from "../../domain/rules";

/*
 * The Rule card's form state, kept apart from the component so the diff
 * that is sent to `saveRule` can be tested. Parameters are held as the text
 * in the input, so a person can clear a box and type without it snapping.
 */

export type RuleDraft = {
  enabled: boolean;
  severity: Severity;
  params: Record<string, string>;
};

export function ruleDef(id: string): RuleDef | undefined {
  return RULES.find((item) => item.id === id);
}

export function isLocked(id: string): boolean {
  return LOCKED_ON.includes(id);
}

export function draftFrom(rule: Rule): RuleDraft {
  return {
    enabled: rule.enabled,
    severity: rule.severity,
    params: Object.fromEntries(
      Object.entries(rule.params).map(([key, value]) => [key, String(value)]),
    ),
  };
}

/** On the Parameter's step grid as the server rounds it (multiples of `step`), or the default itself. */
function inStep(def: RuleDef, param: ParamDef, value: number): boolean {
  if (value === def.defaults[param.key]) return true;
  const steps = value / param.step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** What is wrong with each Parameter the person typed, keyed by Parameter. */
export function draftErrors(
  def: RuleDef,
  draft: RuleDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const param of def.params) {
    const text = (draft.params[param.key] ?? "").trim();
    const value = Number(text);
    if (text === "" || !Number.isFinite(value)) {
      errors[param.key] = "Enter a number.";
    } else if (value < param.min || value > param.max) {
      errors[param.key] = `Between ${param.min} and ${param.max}.`;
    } else if (!inStep(def, param, value)) {
      errors[param.key] = `In steps of ${param.step}.`;
    }
  }
  // A range Rule ("between {min} and {max}") must not be turned inside out.
  const low = Number(draft.params.min);
  const high = Number(draft.params.max);
  if (
    def.params.some((param) => param.key === "min") &&
    def.params.some((param) => param.key === "max") &&
    !errors.min &&
    !errors.max &&
    low > high
  ) {
    errors.max = "Must not be below the lower limit.";
  }
  return errors;
}

/**
 * The override to save: the Rule's whole override, every field that differs
 * from the DEFAULT (not from the last save), or null when the draft is the
 * default again. The server replaces the stored override with exactly this.
 */
export function toOverride(
  def: RuleDef,
  draft: RuleDraft,
): RuleOverride | null {
  const override: RuleOverride = {};
  if (draft.enabled !== def.enabled && !(isLocked(def.id) && !draft.enabled)) {
    override.enabled = draft.enabled;
  }
  if (draft.severity !== def.severity) override.severity = draft.severity;
  const params: Record<string, number> = {};
  for (const param of def.params) {
    const value = Number(draft.params[param.key]);
    if (Number.isFinite(value) && value !== def.defaults[param.key]) {
      params[param.key] = value;
    }
  }
  if (Object.keys(params).length > 0) override.params = params;
  return Object.keys(override).length > 0 ? override : null;
}

/** True when the draft differs from the Rule as it is saved now. */
export function isDirty(rule: Rule, draft: RuleDraft): boolean {
  if (draft.enabled !== rule.enabled || draft.severity !== rule.severity)
    return true;
  return Object.entries(rule.params).some(
    ([key, value]) => Number(draft.params[key]) !== value,
  );
}

/** The Rule as the draft would make it, for the live description. */
export function previewRule(rule: Rule, draft: RuleDraft): Rule {
  const params = { ...rule.params };
  for (const [key, text] of Object.entries(draft.params)) {
    const value = Number(text);
    if (text.trim() !== "" && Number.isFinite(value)) params[key] = value;
  }
  return {
    ...rule,
    enabled: draft.enabled,
    severity: draft.severity,
    params,
  };
}
