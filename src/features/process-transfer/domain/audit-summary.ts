import { MODELS, type ModelChoice, PURPOSE_IDS, PURPOSES } from "./models";
import { RULES, type Rule } from "./rules";

/*
 * The sentences the Audit trail shows for a person's changes. A summary
 * says what changed, old to new, so the trail reads without the detail.
 */

function paramLabel(ruleId: string, key: string) {
  const def = RULES.find((item) => item.id === ruleId);
  const param = def?.params.find((item) => item.key === key);
  return {
    label: param?.label ?? key,
    unit: param?.unit ? ` ${param.unit}` : "",
  };
}

/** "Changed 'Few points per slide': Bullets 4 to 3". */
export function ruleChangeSummary(before: Rule, after: Rule): string {
  const changes: string[] = [];
  if (before.enabled !== after.enabled) {
    changes.push(after.enabled ? "turned on" : "turned off");
  }
  if (before.severity !== after.severity) {
    changes.push(
      after.severity === "block" ? "now blocks Approval" : "now only warns",
    );
  }
  for (const key of Object.keys(after.params)) {
    const old = before.params[key];
    const next = after.params[key];
    if (old !== next) {
      const { label, unit } = paramLabel(after.id, key);
      changes.push(`${label} ${old}${unit} to ${next}${unit}`);
    }
  }
  if (changes.length === 0) return `Kept '${after.title}' as it was`;
  return `Changed '${after.title}': ${changes.join(", ")}`;
}

export function rulesResetSummary(edited: Rule[]): string {
  if (edited.length === 0) return "Reset the Rules (none were changed)";
  const names = edited.map((rule) => `'${rule.title}'`);
  return edited.length === 1
    ? `Reset 1 Rule to its default: ${names[0]}`
    : `Reset ${edited.length} Rules to their defaults: ${names.join(", ")}`;
}

/** "Write: Claude Haiku 5.5 to Gemini 3.8 Flash". */
export function modelsChangeSummary(
  before: ModelChoice,
  after: ModelChoice,
): string {
  const changes = PURPOSE_IDS.filter(
    (purpose) => before[purpose] !== after[purpose],
  ).map(
    (purpose) =>
      `${PURPOSES[purpose].label}: ${MODELS[before[purpose]]?.label ?? before[purpose]} to ${MODELS[after[purpose]]?.label ?? after[purpose]}`,
  );
  return changes.length > 0
    ? `Changed models. ${changes.join("; ")}`
    : "Kept the models as they were";
}
