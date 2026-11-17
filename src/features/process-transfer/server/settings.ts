import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  modelsChangeSummary,
  ruleChangeSummary,
  rulesResetSummary,
} from "../domain/audit-summary";
import {
  type ModelChoice,
  modelChoiceSchema,
  modelsFor,
  resolveModels,
} from "../domain/models";
import { withRuleOverride } from "../domain/rule-edits";
import {
  cleanOverrides,
  RULES,
  type Rule,
  type RuleOverride,
  type RuleOverrides,
  resolveRules,
  ruleOverrideSchema,
} from "../domain/rules";
import { auditPerson } from "./audit";
import { editRuleOverrides, saveSettings, settingsOf } from "./repository";

export type OwnerSettings = {
  rules: Rule[];
  ruleOverrides: RuleOverrides;
  rulesVersion: number;
  models: ModelChoice;
};

function view(row: {
  rule_overrides: unknown;
  models: unknown;
  version: number;
}): OwnerSettings {
  const ruleOverrides = cleanOverrides(row.rule_overrides);
  return {
    rules: resolveRules(ruleOverrides),
    ruleOverrides,
    rulesVersion: row.version,
    models: resolveModels(row.models),
  };
}

/** The Owner's Rules and models now: defaults with their overrides on top. */
export async function ownerSettings(owner: Owner): Promise<OwnerSettings> {
  const row = await settingsOf(owner);
  return view(row ?? { rule_overrides: {}, models: {}, version: 0 });
}

export class SettingsError extends Error {}

/** Sets one Rule's override (null puts it back to default) and writes what changed to the Audit trail. */
export async function saveRule(
  owner: Owner,
  ruleId: unknown,
  override: unknown,
): Promise<OwnerSettings> {
  const def = RULES.find((item) => item.id === ruleId);
  if (!def) throw new SettingsError("There is no such Rule.");
  let parsed: RuleOverride | null = null;
  if (override !== null) {
    const result = ruleOverrideSchema.safeParse(override);
    if (!result.success) throw new SettingsError("That change is not valid.");
    parsed = result.data;
  }
  const edited = await editRuleOverrides(owner, (current) =>
    withRuleOverride(cleanOverrides(current), def.id, parsed),
  );
  const before = view(edited.before);
  const saved = view(edited.after);
  const old = before.rules.find((item) => item.id === def.id);
  const now = saved.rules.find((item) => item.id === def.id);
  if (old && now) {
    await auditPerson({
      owner,
      action: "rule.changed",
      runId: null,
      summary: ruleChangeSummary(old, now),
      detail: {
        ruleId: def.id,
        before: {
          enabled: old.enabled,
          severity: old.severity,
          params: old.params,
        },
        after: {
          enabled: now.enabled,
          severity: now.severity,
          params: now.params,
        },
        rulesVersion: saved.rulesVersion,
      },
    });
  }
  return saved;
}

export async function resetRules(owner: Owner): Promise<OwnerSettings> {
  const before = await ownerSettings(owner);
  const saved = view(await saveSettings(owner, { ruleOverrides: {} }));
  await auditPerson({
    owner,
    action: "rules.reset",
    runId: null,
    summary: rulesResetSummary(before.rules.filter((rule) => rule.edited)),
    detail: {
      before: before.ruleOverrides,
      rulesVersion: saved.rulesVersion,
    },
  });
  return saved;
}

export async function saveModels(
  owner: Owner,
  input: unknown,
): Promise<OwnerSettings> {
  const parsed = modelChoiceSchema.safeParse(input);
  if (!parsed.success) throw new SettingsError("Pick a model for each part.");
  const choice = parsed.data;
  if (!modelsFor("watch").includes(choice.watch)) {
    throw new SettingsError("Only a model that takes video can Watch.");
  }
  const before = await ownerSettings(owner);
  const saved = view(await saveSettings(owner, { models: choice }));
  await auditPerson({
    owner,
    action: "models.changed",
    runId: null,
    summary: modelsChangeSummary(before.models, saved.models),
    detail: { before: before.models, after: saved.models },
  });
  return saved;
}
