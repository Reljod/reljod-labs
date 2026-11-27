import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { RuleWriteResponse } from "../../domain/api";
import { LIMITS } from "../../domain/limits";
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
} from "../../domain/rules";
import type { RuleVersionView, RuleView } from "../../view";
import type { Caller, RuleRepository, SavedRuleVersion } from "../ports";

/**
 * The Rules an Owner edits (ADR 0019). Every edit is checked by the Rule's
 * own spec before it is saved, a stored Version is checked again before it is
 * restored, and each save lands with its Audit event in one transaction.
 */
export interface RulesService {
  list(owner: Owner): Promise<RuleView[]>;
  versions(owner: Owner, ruleId: string): Promise<RuleVersionView[]>;
  /** The Owner's Rules as a Pre-screen started now applies them. */
  states(owner: Owner): Promise<Partial<Record<RuleId, RuleState>>>;
  save(
    caller: Caller,
    ruleId: string,
    edit: RuleEdit,
  ): Promise<RuleWriteResponse>;
  restore(
    caller: Caller,
    ruleId: string,
    version: number,
  ): Promise<RuleWriteResponse>;
}

const stateOf = (row: SavedRuleVersion) =>
  storedRuleState(ruleSpec(row.ruleId as RuleId), row);

/** The newest saved row of each Rule; Rules never saved are absent. */
function latestByRule(rows: SavedRuleVersion[]) {
  const latest = new Map<RuleId, SavedRuleVersion>();
  for (const row of rows) {
    if (!isRuleId(row.ruleId)) continue;
    const seen = latest.get(row.ruleId);
    if (!seen || row.version > seen.version) latest.set(row.ruleId, row);
  }
  return latest;
}

const describe = (ruleId: RuleId, state: Omit<RuleState, "version">) =>
  `${state.enabled ? "" : "(off) "}${ruleSentence(ruleSpec(ruleId), state.params)}`;

const sameState = (
  a: Omit<RuleState, "version">,
  b: Omit<RuleState, "version">,
) =>
  a.enabled === b.enabled &&
  JSON.stringify(a.params) === JSON.stringify(b.params);

function ruleIdOf(value: string): RuleId {
  if (!isRuleId(value)) throw new NotFoundError("No such Rule.");
  return value;
}

/** A Rule's saved Versions, newest first, then its Default as Version 0. */
function versionViews(
  ruleId: RuleId,
  rows: SavedRuleVersion[],
): RuleVersionView[] {
  return [
    ...rows.map(
      (row): RuleVersionView => ({
        ...stateOf(row),
        restoredFrom: row.restoredFrom,
        savedBy: row.savedBy,
        savedAt: row.savedAt,
      }),
    ),
    {
      ...defaultRuleState(ruleSpec(ruleId)),
      restoredFrom: null,
      savedBy: "Default",
      savedAt: null,
    },
  ];
}

export function createRulesService(ports: {
  rules: RuleRepository;
}): RulesService {
  const { rules } = ports;

  async function write(input: {
    caller: Caller;
    ruleId: RuleId;
    from: RuleState;
    next: Omit<RuleState, "version">;
    restoredFrom: number | null;
  }): Promise<RuleWriteResponse> {
    const { caller, ruleId, from, next, restoredFrom } = input;
    const saved = await rules.saveVersion({
      owner: caller.owner,
      ruleId,
      enabled: next.enabled,
      params: next.params,
      restoredFrom,
      savedBy: caller.actor.label,
      summary:
        restoredFrom === null
          ? describe(ruleId, next)
          : `Restored Version ${restoredFrom}: ${describe(ruleId, next)}`,
      details: {
        from: {
          version: from.version,
          enabled: from.enabled,
          params: from.params,
        },
        to: { enabled: next.enabled, params: next.params },
      },
      maxPerHour: LIMITS.ruleSavesPerHour,
    });
    if ("refusal" in saved) {
      throw new LimitError(
        `You can save up to ${LIMITS.ruleSavesPerHour} Rule changes an hour. Try again later.`,
      );
    }
    return { version: saved.version };
  }

  return {
    async list(owner) {
      const rows = await rules.versions(owner);
      const latest = latestByRule(rows);
      return RULE_SPECS.map((spec) => {
        const row = latest.get(spec.id);
        const state = row ? stateOf(row) : defaultRuleState(spec);
        return {
          id: spec.id,
          state,
          edited: !isDefaultState(spec, state),
          savedBy: row?.savedBy ?? null,
          savedAt: row?.savedAt ?? null,
          versionCount: rows.filter((item) => item.ruleId === spec.id).length,
        };
      });
    },

    async versions(owner, ruleId) {
      const id = ruleIdOf(ruleId);
      return versionViews(id, await rules.versions(owner, id));
    },

    async states(owner) {
      const latest = latestByRule(await rules.versions(owner));
      return Object.fromEntries(
        [...latest.entries()].map(([id, row]) => [id, stateOf(row)]),
      );
    },

    async save(caller, ruleId, edit) {
      const id = ruleIdOf(ruleId);
      const spec = ruleSpec(id);
      const [current] = await rules.versions(caller.owner, id);
      const from = current ? stateOf(current) : defaultRuleState(spec);
      const result = applyRuleEdit(spec, from, edit);
      if (!result.ok) {
        throw new InvalidError(
          result.errors.map((item) => item.message).join(" "),
          { errors: result.errors },
        );
      }
      if (sameState(result.next, from)) {
        throw new ConflictError("Nothing changed.");
      }
      return write({
        caller,
        ruleId: id,
        from,
        next: result.next,
        restoredFrom: null,
      });
    },

    async restore(caller, ruleId, version) {
      const id = ruleIdOf(ruleId);
      const spec = ruleSpec(id);
      // One read: the Versions, newest first, hold the one in force too.
      const versions = versionViews(id, await rules.versions(caller.owner, id));
      const target = versions.find((item) => item.version === version);
      if (!target) throw new NotFoundError("No such Version.");
      const from = versions[0];
      const next = { enabled: target.enabled, params: target.params };
      if (sameState(next, from)) {
        throw new ConflictError("That Version is already in force.");
      }
      // A stored Version is checked again: a Rule's Parameters may have changed since.
      const checked = applyRuleEdit(spec, defaultRuleState(spec), next);
      if (!checked.ok) {
        throw new ConflictError("That Version no longer fits this Rule.");
      }
      return write({
        caller,
        ruleId: id,
        from,
        next: checked.next,
        restoredFrom: version,
      });
    },
  };
}
