import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { LIMITS } from "../domain/limits";
import {
  resolveRulebook,
  ruleDefinition,
  validateRuleEdit,
} from "../domain/rules";
import { jsonb, sql } from "./db";
import { LimitError, RuleRefusedError } from "./errors";
import { emit, ruleRows } from "./store";

/**
 * Saves an edit of one Rule as its next Version. Rules are data (the ADR
 * 0015 shape): the Default is Version 1 in code, an edit is a row, and the
 * next Call starts under the new Rulebook. A Call already live keeps the one
 * it started under.
 */
export async function saveRule(input: {
  owner: Owner;
  ruleId: string;
  enabled: unknown;
  params: unknown;
  note?: string | null;
}) {
  const checked = validateRuleEdit(input.ruleId, {
    enabled: input.enabled,
    params: input.params,
  });
  if (!checked.ok) throw new RuleRefusedError(checked.errors);
  const note = input.note?.trim().slice(0, 200) || null;
  const version = await sql().begin(async (tx) => {
    await tx`select 1 from switchboard.workspaces where owner = ${input.owner} for update`;
    const [row] = await tx<{ latest: number | null; count: number }[]>`
      select max(version) as latest, count(*)::int as count
      from switchboard.rule_versions
      where owner = ${input.owner} and rule_id = ${input.ruleId}`;
    if ((row?.count ?? 0) >= LIMITS.ruleVersions)
      throw new LimitError(
        `A Rule keeps ${LIMITS.ruleVersions} Versions. This one is full.`,
      );
    const next = Math.max(1, row?.latest ?? 1) + 1;
    await tx`
      insert into switchboard.rule_versions (owner, rule_id, version, enabled, params, note)
      values (${input.owner}, ${input.ruleId}, ${next}, ${checked.enabled},
        ${jsonb(tx, checked.params)}, ${note})`;
    await emit(tx, input.owner, null, "owner", "rule.saved", {
      ruleId: input.ruleId,
      version: next,
      enabled: checked.enabled,
      note,
    });
    return next;
  });
  return { ruleId: input.ruleId, version };
}

/** Puts a Rule back to its Default, as a new Version: nothing is ever unsaved. */
export async function restoreRule(owner: Owner, ruleId: string) {
  const rule = ruleDefinition(ruleId);
  if (!rule)
    throw new RuleRefusedError([{ field: "rule", message: "No such Rule." }]);
  return saveRule({
    owner,
    ruleId,
    enabled: true,
    params: rule.defaults,
    note: "Back to the Default",
  });
}

/** The Rulebook in force with each Rule's saved Versions, for the Rules tab. */
export async function rulesView(owner: Owner) {
  const rows = await ruleRows(owner);
  return { rulebook: resolveRulebook(rows), versions: rows };
}
