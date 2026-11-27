import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { jsonb, sql } from "./db";
import { emit } from "./store";

/**
 * Saves a checked edit of one Rule as its next Version, with its Event, under
 * the Workspace lock. Null when the Rule already keeps `max` Versions. Rules
 * are data (the ADR 0015 shape): the Default is Version 1 in code, an edit is
 * a row, and the next Call starts under the new Rulebook.
 */
export async function addRuleVersion(
  owner: Owner,
  edit: {
    ruleId: string;
    enabled: boolean;
    params: Record<string, unknown>;
    note: string | null;
  },
  max: number,
): Promise<number | null> {
  return sql().begin(async (tx) => {
    await tx`select 1 from switchboard.workspaces where owner = ${owner} for update`;
    const [row] = await tx<{ latest: number | null; count: number }[]>`
      select max(version) as latest, count(*)::int as count
      from switchboard.rule_versions
      where owner = ${owner} and rule_id = ${edit.ruleId}`;
    if ((row?.count ?? 0) >= max) return null;
    const next = Math.max(1, row?.latest ?? 1) + 1;
    await tx`
      insert into switchboard.rule_versions (owner, rule_id, version, enabled, params, note)
      values (${owner}, ${edit.ruleId}, ${next}, ${edit.enabled},
        ${jsonb(tx, edit.params)}, ${edit.note})`;
    await emit(tx, owner, null, "owner", "rule.saved", {
      ruleId: edit.ruleId,
      version: next,
      enabled: edit.enabled,
      note: edit.note,
    });
    return next;
  });
}
