import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, NotFoundError } from "@/platform/errors";
import {
  modelsChangeSummary,
  ruleChangeSummary,
  rulesResetSummary,
} from "../../domain/audit-summary";
import {
  type ModelChoice,
  modelsFor,
  resolveModels,
} from "../../domain/models";
import { withRuleOverride } from "../../domain/rule-edits";
import {
  cleanOverrides,
  RULES,
  type Rule,
  type RuleOverride,
  type RuleOverrides,
  resolveRules,
} from "../../domain/rules";
import type { AuditLog, SettingsRepository } from "../ports";

export type OwnerSettings = {
  rules: Rule[];
  ruleOverrides: RuleOverrides;
  rulesVersion: number;
  models: ModelChoice;
};

/**
 * An Owner's Rules and models. Every change bumps the settings' version
 * (each Run records the version it used) and writes what changed to the
 * Audit trail.
 */
export interface SettingsService {
  /** The Rules and models now: defaults with the Owner's overrides on top. */
  current(owner: Owner): Promise<OwnerSettings>;
  /** Sets one Rule's override; null puts it back to default. */
  saveRule(
    owner: Owner,
    ruleId: string,
    override: RuleOverride | null,
  ): Promise<OwnerSettings>;
  resetRules(owner: Owner): Promise<OwnerSettings>;
  saveModels(owner: Owner, models: ModelChoice): Promise<OwnerSettings>;
}

export type SettingsPorts = {
  settings: SettingsRepository;
  audit: Pick<AuditLog, "person">;
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

export function createSettingsService(ports: SettingsPorts): SettingsService {
  const { settings, audit } = ports;

  async function current(owner: Owner) {
    const row = await settings.of(owner);
    return view(row ?? { rule_overrides: {}, models: {}, version: 0 });
  }

  return {
    current,

    async saveRule(owner, ruleId, override) {
      const def = RULES.find((item) => item.id === ruleId);
      if (!def) throw new NotFoundError("There is no such Rule.");
      const edited = await settings.editRuleOverrides(owner, (stored) =>
        withRuleOverride(cleanOverrides(stored), def.id, override),
      );
      const before = view(edited.before);
      const saved = view(edited.after);
      const old = before.rules.find((item) => item.id === def.id);
      const now = saved.rules.find((item) => item.id === def.id);
      if (old && now) {
        await audit.person({
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
    },

    async resetRules(owner) {
      const before = await current(owner);
      const saved = view(await settings.save(owner, { ruleOverrides: {} }));
      await audit.person({
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
    },

    async saveModels(owner, choice) {
      if (!modelsFor("watch").includes(choice.watch)) {
        throw new InvalidError("Only a model that takes video can Watch.");
      }
      const before = await current(owner);
      const saved = view(await settings.save(owner, { models: choice }));
      await audit.person({
        owner,
        action: "models.changed",
        runId: null,
        summary: modelsChangeSummary(before.models, saved.models),
        detail: { before: before.models, after: saved.models },
      });
      return saved;
    },
  };
}
