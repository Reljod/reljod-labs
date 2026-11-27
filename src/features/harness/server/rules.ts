import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import type { PipelineId } from "../domain/pipeline";
import {
  type RuleStates,
  resolveRuleStatesAsOf,
  type SavedRuleVersion,
} from "../domain/pipelines/apply";
import { bankToday } from "../domain/pipelines/dates";
import {
  defaultRuleState,
  type Outcome,
  type RuleParams,
  type RuleSpec,
  type RuleState,
  type RuleVersion,
  type RuleView,
} from "../domain/rules";
import { RULE_SPECS } from "../domain/rules/defaults";
import {
  latestOf,
  nextScheduledRuleState,
  nextVersion,
  resolveRuleAsOf,
  resolveRuleState,
  sameRuleState,
} from "../domain/skills/versions";
import { auditIn } from "./audit";
import { type Db, jsonb, sql } from "./db";
import type { RuleRepository } from "./ports";

/*
 * Rules are data (ADR 0015): `RULE_SPECS` are the Defaults and
 * `harness.rule_versions` holds a Workspace's edits. No row for a Rule means
 * its Default (Version 0). A save never updates a row: it adds Version n+1.
 * What an edit may say is the Rules service's; this is the SQL.
 */

type RuleRow = {
  rule_id: string;
  version: number;
  enabled: boolean;
  params: RuleParams;
  outcome: Outcome;
  effective_from: string;
  saved_by: string;
  saved_by_name: string;
  note: string | null;
  created_at: Date;
};

/** The columns every read takes; `effective_from` as text so it is not shifted by a time zone. */
const COLUMNS = (db: Db) => db`
  rv.rule_id, rv.version, rv.enabled, rv.params, rv.outcome,
  to_char(rv.effective_from, 'YYYY-MM-DD') as effective_from,
  rv.saved_by, st.name as saved_by_name, rv.note, rv.created_at`;

const stateOf = (spec: RuleSpec, row: RuleRow): RuleState =>
  resolveRuleState(spec, {
    version: row.version,
    enabled: row.enabled,
    params: row.params ?? {},
    outcome: row.outcome,
    effectiveFrom: row.effective_from,
  });

function specOf(ruleId: string): RuleSpec {
  const spec = RULE_SPECS.find((candidate) => candidate.id === ruleId);
  if (!spec) throw new NotFoundError("There is no such Rule.");
  return spec;
}

const savedOf = (row: RuleRow): SavedRuleVersion => ({
  version: row.version,
  enabled: row.enabled,
  params: row.params ?? {},
  outcome: row.outcome,
  effectiveFrom: row.effective_from,
});

/**
 * A Rule card's data: the latest Version (`row`, what the editor edits) and,
 * from all its saved Versions, the one in force today.
 */
function viewOf(
  spec: RuleSpec,
  row: RuleRow | null,
  versions: readonly RuleRow[],
  today = bankToday(),
): RuleView {
  const state = row ? stateOf(spec, row) : defaultRuleState(spec);
  const saved = versions.map(savedOf);
  return {
    spec,
    state,
    inForce: resolveRuleAsOf(spec, saved, today),
    scheduled: nextScheduledRuleState(spec, saved, today),
    edited: row ? !sameRuleState(spec, state, defaultRuleState(spec)) : false,
    savedBy: row ? { id: row.saved_by, name: row.saved_by_name } : null,
    savedAt: row ? row.created_at.toISOString() : null,
  };
}

/** Every saved Version of the given Rules, newest first per Rule, in one query. */
async function allRows(
  db: Db,
  owner: Owner,
  ruleIds: string[],
): Promise<Map<string, RuleRow[]>> {
  const rows = await db<RuleRow[]>`
    select ${COLUMNS(db)}
    from harness.rule_versions rv
    join harness.staff st on st.id = rv.saved_by
    where rv.owner = ${owner} and rv.rule_id in ${db(ruleIds)}
    order by rv.rule_id, rv.version desc`;
  const byRule = new Map<string, RuleRow[]>();
  for (const row of rows) {
    const list = byRule.get(row.rule_id) ?? [];
    list.push(row);
    byRule.set(row.rule_id, list);
  }
  return byRule;
}

async function versionRows(
  db: Db,
  owner: Owner,
  ruleId: string,
): Promise<RuleRow[]> {
  return db<RuleRow[]>`
    select ${COLUMNS(db)}
    from harness.rule_versions rv
    join harness.staff st on st.id = rv.saved_by
    where rv.owner = ${owner} and rv.rule_id = ${ruleId}
    order by rv.version desc`;
}

/** Every Rule as the Workspace has it now (latest Version, and the one in force today), in spec order; one Pipeline's when given. */
export async function listRules(
  owner: Owner,
  pipelineId?: PipelineId | null,
): Promise<RuleView[]> {
  const specs = RULE_SPECS.filter(
    (spec) => !pipelineId || spec.pipelineId === pipelineId,
  );
  if (specs.length === 0) return [];
  const rows = await allRows(
    sql(),
    owner,
    specs.map((spec) => spec.id),
  );
  return specs.map((spec) => {
    const versions = rows.get(spec.id) ?? [];
    return viewOf(spec, latestOf(versions), versions);
  });
}

/**
 * The states a Run of `pipelineId` applies on `asOf`: each Rule at the
 * highest Version already in effect on that date, else its Default, else
 * null (not yet in force; the Run skips it). A Run snapshots the Versions
 * from this.
 */
async function ruleStatesAsOf(
  owner: Owner,
  pipelineId: PipelineId,
  asOf: string,
): Promise<RuleStates> {
  const ids = RULE_SPECS.filter((spec) => spec.pipelineId === pipelineId).map(
    (spec) => spec.id,
  );
  if (ids.length === 0) return {};
  const rows = await allRows(sql(), owner, ids);
  const saved: Record<string, SavedRuleVersion[]> = {};
  for (const [ruleId, list] of rows) saved[ruleId] = list.map(savedOf);
  return resolveRuleStatesAsOf(pipelineId, saved, asOf);
}

export const ruleRepository: RuleRepository = {
  list: listRules,
  statesAsOf: ruleStatesAsOf,

  async history(owner, ruleId): Promise<RuleVersion[]> {
    const spec = specOf(ruleId);
    const rows = await versionRows(sql(), owner, spec.id);
    return rows.map((row) => ({
      ...stateOf(spec, row),
      ruleId: spec.id,
      savedBy: { id: row.saved_by, name: row.saved_by_name },
      note: row.note,
      createdAt: row.created_at.toISOString(),
    }));
  },

  /**
   * Under the Workspace's lock on the Rule (two saves at once get Versions
   * n+1 and n+2, not two n+1): the saved Versions are read once, the plan
   * decides, Version n+1 and its event go in the same transaction.
   */
  async saveVersion(owner, ruleId, staffId, plan) {
    const spec = specOf(ruleId);
    const versions = await sql().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`harness:rule:${owner}:${spec.id}`}, 0))`;
      const rows = await versionRows(tx, owner, spec.id);
      const latest = latestOf(rows);
      const decided = plan({
        current: latest ? stateOf(spec, latest) : defaultRuleState(spec),
        versions: rows.map((row) => ({
          ...stateOf(spec, row),
          version: row.version,
        })),
      });
      const version = nextVersion(rows.map((row) => row.version));
      await tx`
        insert into harness.rule_versions
          (owner, rule_id, version, enabled, params, outcome, effective_from, saved_by, note)
        values (
          ${owner}, ${spec.id}, ${version}, ${decided.state.enabled},
          ${jsonb(tx, decided.state.params)}, ${decided.state.outcome},
          ${decided.state.effectiveFrom}::date, ${staffId}, ${decided.note}
        )`;
      await auditIn(tx, decided.event(version));
      return versionRows(tx, owner, spec.id);
    });
    return viewOf(spec, latestOf(versions), versions);
  },
};
