import { cleanOverrides, type RuleOverride, type RuleOverrides } from "./rules";

/**
 * An Owner's overrides after saving one Rule. The page sends the Rule's
 * whole override (only what differs from the default), so it replaces the
 * stored one: a field put back to its default is absent and must not keep
 * its old value. Null puts the Rule back to its default.
 */
export function withRuleOverride(
  overrides: RuleOverrides,
  ruleId: string,
  override: RuleOverride | null,
): RuleOverrides {
  const next: RuleOverrides = { ...overrides };
  if (override) next[ruleId] = override;
  else delete next[ruleId];
  return cleanOverrides(next);
}
