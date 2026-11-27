import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, LimitError } from "@/platform/errors";
import type { RulesView } from "../../domain/api";
import { LIMITS } from "../../domain/limits";
import {
  type RuleEditError,
  resolveRulebook,
  ruleDefinition,
  validateRuleEdit,
} from "../../domain/rules";
import type { SwitchboardPorts } from "../ports";

export type RuleEdit = {
  ruleId: string;
  enabled: unknown;
  params: unknown;
  note?: string | null;
};

export type SavedRule = { ruleId: string; version: number };

/**
 * The Owner's Rulebook. Rules are data (the ADR 0015 shape): the Default is
 * Version 1 in code, an edit is the next Version, and the next Call starts
 * under it; a Call already live keeps the Rulebook it started under.
 */
export interface RulesService {
  view(owner: Owner): Promise<RulesView>;
  /** Saves a checked edit; a bad one answers 400 with every `errors` item. */
  save(owner: Owner, edit: RuleEdit): Promise<SavedRule>;
  /** The Default back, as a new Version: nothing is ever unsaved. */
  restore(owner: Owner, ruleId: string): Promise<SavedRule>;
  /** An edit of only what is given; the rest keeps the Rule's current Version (MCP's `save_rule`). */
  amend(
    owner: Owner,
    edit: {
      ruleId: string;
      enabled?: boolean;
      params?: Record<string, unknown>;
      note?: string;
    },
  ): Promise<SavedRule>;
}

const refused = (errors: RuleEditError[]) =>
  new InvalidError(errors[0]?.message ?? "That Rule edit doesn't look right.", {
    errors,
  });

export function createRulesService(ports: SwitchboardPorts): RulesService {
  const { store } = ports;

  async function view(owner: Owner): Promise<RulesView> {
    const versions = await store.ruleRows(owner);
    return { rulebook: resolveRulebook(versions), versions };
  }

  async function save(owner: Owner, edit: RuleEdit): Promise<SavedRule> {
    const checked = validateRuleEdit(edit.ruleId, {
      enabled: edit.enabled,
      params: edit.params,
    });
    if (!checked.ok) throw refused(checked.errors);
    const version = await store.addRuleVersion(
      owner,
      {
        ruleId: edit.ruleId,
        enabled: checked.enabled,
        params: checked.params,
        note: edit.note?.trim().slice(0, 200) || null,
      },
      LIMITS.ruleVersions,
    );
    if (version === null)
      throw new LimitError(
        `A Rule keeps ${LIMITS.ruleVersions} Versions. This one is full.`,
      );
    return { ruleId: edit.ruleId, version };
  }

  return {
    view,
    save,

    async restore(owner, ruleId) {
      const rule = ruleDefinition(ruleId);
      if (!rule) throw refused([{ field: "rule", message: "No such Rule." }]);
      return save(owner, {
        ruleId,
        enabled: true,
        params: rule.defaults,
        note: "Back to the Default",
      });
    },

    async amend(owner, edit) {
      const { rulebook } = await view(owner);
      const current = rulebook.find((rule) => rule.id === edit.ruleId);
      return save(owner, {
        ruleId: edit.ruleId,
        enabled: edit.enabled ?? current?.enabled ?? true,
        params: { ...current?.params, ...edit.params },
        note: edit.note,
      });
    },
  };
}
