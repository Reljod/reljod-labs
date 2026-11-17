import type { PipelineSpec } from "../pipeline";
import type { RuleView } from "../rules";

export type RuleGroup = {
  /** The Step's id, or `other` for Rules whose Step is not in the Pipeline. */
  stepId: string;
  title: string;
  rules: RuleView[];
};

/**
 * A Rulebook's Rules grouped by Pipeline Step, in the Pipeline's Step order,
 * so the cards read the way the Run goes. Steps with no Rule are left out;
 * Rules whose Step is unknown (or when the Pipeline is not known) follow,
 * grouped by their own Step id.
 */
export function groupRulesByStep(
  pipeline: Pick<PipelineSpec, "steps"> | null,
  rules: readonly RuleView[],
): RuleGroup[] {
  const groups: RuleGroup[] = [];
  const placed = new Set<string>();
  for (const step of pipeline?.steps ?? []) {
    const mine = rules.filter((rule) => rule.spec.stepId === step.id);
    if (mine.length === 0) continue;
    for (const rule of mine) placed.add(rule.spec.id);
    groups.push({ stepId: step.id, title: step.title, rules: mine });
  }
  const rest = rules.filter((rule) => !placed.has(rule.spec.id));
  const byStep = new Map<string, RuleView[]>();
  for (const rule of rest) {
    byStep.set(rule.spec.stepId, [
      ...(byStep.get(rule.spec.stepId) ?? []),
      rule,
    ]);
  }
  for (const [stepId, mine] of byStep) {
    groups.push({ stepId, title: stepId.replace(/[-_]/g, " "), rules: mine });
  }
  return groups;
}

/** The counts the Rulebook header shows: Rules, edited ones and switched-off ones. */
export function ruleSummary(rules: readonly RuleView[]) {
  return {
    total: rules.length,
    edited: rules.filter((rule) => rule.edited).length,
    off: rules.filter((rule) => !rule.state.enabled).length,
  };
}
