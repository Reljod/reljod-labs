import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditActor } from "../domain/audit";
import { LIMITS } from "../domain/review";
import {
  applyRuleEdit,
  defaultRuleState,
  isDefaultState,
  isRuleId,
  RULE_SPECS,
  type RuleEdit,
  type RuleId,
  type RuleState,
  ruleSentence,
  ruleSpec,
  storedRuleState,
} from "../domain/rules";
import type { RuleVersionView, RuleView } from "../view";
import { supabase } from "./supabase";

type VersionRow = {
  rule_id: string;
  version: number;
  enabled: boolean;
  params: unknown;
  restored_from: number | null;
  saved_by: string;
  created_at: string;
};

const VERSION_COLUMNS =
  "rule_id, version, enabled, params, restored_from, saved_by, created_at";

async function versionRows(owner: Owner, ruleId?: RuleId) {
  let query = supabase()
    .from("rule_versions")
    .select(VERSION_COLUMNS)
    .eq("owner", owner)
    .order("version", { ascending: false });
  if (ruleId) query = query.eq("rule_id", ruleId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as VersionRow[];
}

/** The newest saved row of each Rule; Rules never saved are absent. */
function latestByRule(rows: VersionRow[]) {
  const latest = new Map<RuleId, VersionRow>();
  for (const row of rows) {
    if (!isRuleId(row.rule_id)) continue;
    const seen = latest.get(row.rule_id);
    if (!seen || row.version > seen.version) latest.set(row.rule_id, row);
  }
  return latest;
}

const stateOf = (row: VersionRow) =>
  storedRuleState(ruleSpec(row.rule_id as RuleId), row);

/** The Owner's Rules as a Pre-screen started now applies them. */
export async function ownerRuleStates(
  owner: Owner,
): Promise<Partial<Record<RuleId, RuleState>>> {
  const latest = latestByRule(await versionRows(owner));
  return Object.fromEntries(
    [...latest.entries()].map(([id, row]) => [id, stateOf(row)]),
  );
}

/** Every Rule as the Owner has it, for the Rules page. */
export async function listRules(owner: Owner): Promise<RuleView[]> {
  const rows = await versionRows(owner);
  const latest = latestByRule(rows);
  return RULE_SPECS.map((spec) => {
    const row = latest.get(spec.id);
    const state = row ? stateOf(row) : defaultRuleState(spec);
    return {
      id: spec.id,
      state,
      edited: !isDefaultState(spec, state),
      savedBy: row?.saved_by ?? null,
      savedAt: row?.created_at ?? null,
      versionCount: rows.filter((item) => item.rule_id === spec.id).length,
    };
  });
}

/** A Rule's saved Versions, newest first, then its Default as Version 0. */
export async function listRuleVersions(
  owner: Owner,
  ruleId: RuleId,
): Promise<RuleVersionView[]> {
  const spec = ruleSpec(ruleId);
  const saved = (await versionRows(owner, ruleId)).map(
    (row): RuleVersionView => ({
      ...stateOf(row),
      restoredFrom: row.restored_from,
      savedBy: row.saved_by,
      savedAt: row.created_at,
    }),
  );
  return [
    ...saved,
    {
      ...defaultRuleState(spec),
      restoredFrom: null,
      savedBy: "Default",
      savedAt: null,
    },
  ];
}

export type RuleWriteResult =
  | { ok: true; version: number }
  | {
      ok: false;
      message: string;
      errors?: { param: string | null; message: string }[];
    };

const describe = (ruleId: RuleId, state: Omit<RuleState, "version">) =>
  `${state.enabled ? "" : "(off) "}${ruleSentence(ruleSpec(ruleId), state.params)}`;

function limitMessage(error: { message: string }): string | null {
  return error.message.includes("limit_reached")
    ? `You can save up to ${LIMITS.ruleSavesPerHour} Rule changes an hour. Try again later.`
    : null;
}

async function writeVersion(input: {
  owner: Owner;
  actor: AuditActor;
  ruleId: RuleId;
  from: RuleState;
  next: Omit<RuleState, "version">;
  restoredFrom: number | null;
}): Promise<RuleWriteResult> {
  const { owner, actor, ruleId, from, next, restoredFrom } = input;
  const summary =
    restoredFrom === null
      ? `${describe(ruleId, next)}`
      : `Restored Version ${restoredFrom}: ${describe(ruleId, next)}`;
  const { data, error } = await supabase().rpc("save_rule_version", {
    p_owner: owner,
    p_rule_id: ruleId,
    p_enabled: next.enabled,
    p_params: next.params,
    p_restored_from: restoredFrom,
    p_saved_by: actor.label,
    p_summary: summary,
    p_details: {
      from: {
        version: from.version,
        enabled: from.enabled,
        params: from.params,
      },
      to: { enabled: next.enabled, params: next.params },
    },
    p_max_per_hour: LIMITS.ruleSavesPerHour,
  });
  if (error) {
    const limited = limitMessage(error);
    if (limited) return { ok: false, message: limited };
    throw new Error(error.message);
  }
  return { ok: true, version: Number(data) };
}

async function currentState(owner: Owner, ruleId: RuleId) {
  const [row] = await versionRows(owner, ruleId);
  return row ? stateOf(row) : defaultRuleState(ruleSpec(ruleId));
}

const sameState = (
  a: Omit<RuleState, "version">,
  b: Omit<RuleState, "version">,
) =>
  a.enabled === b.enabled &&
  JSON.stringify(a.params) === JSON.stringify(b.params);

/** Saves an edit as the Rule's next Version, after checking it against the Rule. */
export async function saveRule(
  owner: Owner,
  actor: AuditActor,
  ruleId: RuleId,
  edit: RuleEdit,
): Promise<RuleWriteResult> {
  const spec = ruleSpec(ruleId);
  const from = await currentState(owner, ruleId);
  const result = applyRuleEdit(spec, from, edit);
  if (!result.ok) {
    return {
      ok: false,
      message: result.errors.map((item) => item.message).join(" "),
      errors: result.errors,
    };
  }
  if (sameState(result.next, from)) {
    return { ok: false, message: "Nothing changed." };
  }
  return writeVersion({
    owner,
    actor,
    ruleId,
    from,
    next: result.next,
    restoredFrom: null,
  });
}

/** Saves an earlier Version (0 for the Default) as the Rule's next one. */
export async function restoreRule(
  owner: Owner,
  actor: AuditActor,
  ruleId: RuleId,
  version: number,
): Promise<RuleWriteResult> {
  const spec = ruleSpec(ruleId);
  const versions = await listRuleVersions(owner, ruleId);
  const target = versions.find((item) => item.version === version);
  if (!target) return { ok: false, message: "No such Version." };
  const from = await currentState(owner, ruleId);
  const next = { enabled: target.enabled, params: target.params };
  if (sameState(next, from)) {
    return { ok: false, message: "That Version is already in force." };
  }
  // A stored Version is checked again: a Rule's Parameters may have changed since.
  const checked = applyRuleEdit(spec, defaultRuleState(spec), next);
  if (!checked.ok) {
    return { ok: false, message: "That Version no longer fits this Rule." };
  }
  return writeVersion({
    owner,
    actor,
    ruleId,
    from,
    next: checked.next,
    restoredFrom: version,
  });
}
