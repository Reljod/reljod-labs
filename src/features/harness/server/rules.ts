import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { PipelineId } from "../domain/pipeline";
import {
  defaultRuleState,
  type Outcome,
  type RuleEdit,
  type RuleParams,
  type RuleSpec,
  type RuleState,
  type RuleVersion,
  type RuleView,
  validateRuleEdit,
} from "../domain/rules";
import { RULE_SPECS } from "../domain/rules/defaults";
import {
  changedParams,
  latestOf,
  nextVersion,
  planRestore,
  resolveRuleState,
  sameRuleState,
} from "../domain/skills/versions";
import type { Actor } from "./actor";
import { auditIn } from "./audit";
import { assertCan } from "./context";
import { type Db, jsonb, sql } from "./db";
import { InvalidError, NotFoundError, RuleRefusedError } from "./errors";

/*
 * Rules are data (ADR 0015): `RULE_SPECS` are the Defaults and
 * `harness.rule_versions` holds a Workspace's edits. No row for a Rule means
 * its Default (Version 0). A save never updates a row: it adds Version n+1.
 */

const NOTE_CHARS = 500;

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

function viewOf(spec: RuleSpec, row: RuleRow | null): RuleView {
  const state = row ? stateOf(spec, row) : defaultRuleState(spec);
  return {
    spec,
    state,
    edited: row ? !sameRuleState(spec, state, defaultRuleState(spec)) : false,
    savedBy: row ? { id: row.saved_by, name: row.saved_by_name } : null,
    savedAt: row ? row.created_at.toISOString() : null,
  };
}

async function latestRows(
  db: Db,
  owner: Owner,
  ruleIds?: string[],
): Promise<Map<string, RuleRow>> {
  const rows = await db<RuleRow[]>`
    select distinct on (rv.rule_id) ${COLUMNS(db)}
    from harness.rule_versions rv
    join harness.staff st on st.id = rv.saved_by
    where rv.owner = ${owner}
      ${ruleIds ? db`and rv.rule_id in ${db(ruleIds)}` : db``}
    order by rv.rule_id, rv.version desc`;
  return new Map(rows.map((row) => [row.rule_id, row]));
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

/** Every Rule as the Workspace has it now, in spec order; one Pipeline's when given. */
export async function listRules(
  owner: Owner,
  pipelineId?: PipelineId | null,
): Promise<RuleView[]> {
  const specs = RULE_SPECS.filter(
    (spec) => !pipelineId || spec.pipelineId === pipelineId,
  );
  if (specs.length === 0) return [];
  const rows = await latestRows(
    sql(),
    owner,
    specs.map((spec) => spec.id),
  );
  return specs.map((spec) => viewOf(spec, rows.get(spec.id) ?? null));
}

/**
 * rule id → the state in force, for every Rule in `RULE_SPECS`. `startRun`
 * snapshots the Versions from this, and a Pipeline's checks read their
 * Parameters from it.
 */
export async function currentRuleStates(
  owner: Owner,
): Promise<Record<string, RuleState>> {
  const views = await listRules(owner);
  return Object.fromEntries(views.map((view) => [view.spec.id, view.state]));
}

const cleanNote = (note: string | null | undefined): string | null => {
  const text = note?.trim();
  if (!text) return null;
  if (text.length > NOTE_CHARS) {
    throw new InvalidError(`The note is at most ${NOTE_CHARS} characters.`);
  }
  return text;
};

/** Takes the Workspace's lock on one Rule so two saves at once get Versions n+1 and n+2, not two n+1. */
async function lockRule(tx: Db, owner: Owner, ruleId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`harness:rule:${owner}:${ruleId}`}, 0))`;
}

async function insertVersion(
  tx: Db,
  input: {
    owner: Owner;
    staffId: string;
    spec: RuleSpec;
    state: Omit<RuleState, "version">;
    note: string | null;
  },
): Promise<RuleRow> {
  const [top] = await tx<{ top: number }[]>`
    select coalesce(max(version), 0)::int as top
    from harness.rule_versions
    where owner = ${input.owner} and rule_id = ${input.spec.id}`;
  const version = nextVersion([top?.top ?? 0]);
  await tx`
    insert into harness.rule_versions
      (owner, rule_id, version, enabled, params, outcome, effective_from, saved_by, note)
    values (
      ${input.owner}, ${input.spec.id}, ${version}, ${input.state.enabled},
      ${jsonb(tx, input.state.params)}, ${input.state.outcome},
      ${input.state.effectiveFrom}::date, ${input.staffId}, ${input.note}
    )`;
  const rows = await versionRows(tx, input.owner, input.spec.id);
  const row = rows.find((candidate) => candidate.version === version);
  if (!row) throw new Error("The Rule Version was not saved.");
  return row;
}

/**
 * Saves an edit as the Rule's next Version. Needs `rule.edit`. A bad edit is
 * refused with a RuleRefusedError naming each field at fault; an edit that
 * changes nothing is refused too. The Audit event is written in the same
 * transaction, with the Parameters that changed.
 */
export async function saveRule(
  input: Actor & { ruleId: string; edit: RuleEdit; note?: string | null },
): Promise<RuleView> {
  assertCan(input.staff, "rule.edit");
  const spec = specOf(input.ruleId);
  const note = cleanNote(input.note);
  const row = await sql().begin(async (tx) => {
    await lockRule(tx, input.owner, spec.id);
    const latest = (await latestRows(tx, input.owner, [spec.id])).get(spec.id);
    const current = latest ? stateOf(spec, latest) : defaultRuleState(spec);
    const result = validateRuleEdit(spec, input.edit, current);
    if (!result.ok) throw new RuleRefusedError(result.errors);
    if (sameRuleState(spec, result.next, current)) {
      throw new InvalidError("Nothing changed: the Rule already says that.");
    }
    const saved = await insertVersion(tx, {
      owner: input.owner,
      staffId: input.staff.id,
      spec,
      state: result.next,
      note,
    });
    await auditIn(tx, {
      owner: input.owner,
      actor: { kind: "staff", staff: input.staff },
      action: "rule.saved",
      summary: `Saved ${spec.title} as Version ${saved.version}`,
      target: { kind: "rule", id: spec.id },
      detail: {
        pipelineId: spec.pipelineId,
        version: saved.version,
        previousVersion: current.version,
        params: changedParams(spec, current.params, result.next.params),
        enabled: [current.enabled, result.next.enabled],
        outcome: [current.outcome, result.next.outcome],
        effectiveFrom: [current.effectiveFrom, result.next.effectiveFrom],
        note,
      },
    });
    return saved;
  });
  return viewOf(spec, row);
}

/**
 * Puts a Rule back to its Default (`version` left out or 0) or to an earlier
 * Version, by saving that state as a new Version. Needs `rule.edit`.
 */
export async function restoreRule(
  input: Actor & { ruleId: string; version?: number | null },
): Promise<RuleView> {
  assertCan(input.staff, "rule.edit");
  const spec = specOf(input.ruleId);
  const row = await sql().begin(async (tx) => {
    await lockRule(tx, input.owner, spec.id);
    const rows = await versionRows(tx, input.owner, spec.id);
    const latest = latestOf(rows);
    const current = latest ? stateOf(spec, latest) : defaultRuleState(spec);
    const plan = planRestore<Omit<RuleState, "version">>(
      defaultRuleState(spec),
      rows.map((saved) => ({
        ...stateOf(spec, saved),
        version: saved.version,
      })),
      input.version,
    );
    if (!plan) throw new NotFoundError("That Version was never saved.");
    if (sameRuleState(spec, plan.state, current)) {
      throw new InvalidError(
        plan.from === null
          ? "The Rule already says what the Default says."
          : `The Rule already says what Version ${plan.from} says.`,
      );
    }
    const saved = await insertVersion(tx, {
      owner: input.owner,
      staffId: input.staff.id,
      spec,
      state: plan.state,
      note: plan.note,
    });
    await auditIn(tx, {
      owner: input.owner,
      actor: { kind: "staff", staff: input.staff },
      action: "rule.restored",
      summary: `${plan.note} on ${spec.title} (now Version ${saved.version})`,
      target: { kind: "rule", id: spec.id },
      detail: {
        pipelineId: spec.pipelineId,
        version: saved.version,
        restoredFrom: plan.from === null ? "default" : plan.from,
        params: changedParams(spec, current.params, plan.state.params),
      },
    });
    return saved;
  });
  return viewOf(spec, row);
}

/** A Rule's saved Versions, newest first. Empty while only the Default applies. */
export async function ruleHistory(
  owner: Owner,
  ruleId: string,
): Promise<RuleVersion[]> {
  const spec = specOf(ruleId);
  const rows = await versionRows(sql(), owner, spec.id);
  return rows.map((row) => ({
    ...stateOf(spec, row),
    ruleId: spec.id,
    savedBy: { id: row.saved_by, name: row.saved_by_name },
    note: row.note,
    createdAt: row.created_at.toISOString(),
  }));
}
