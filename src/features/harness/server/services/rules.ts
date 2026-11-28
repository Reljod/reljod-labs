import "server-only";
import { InvalidError, NotFoundError } from "@/platform/errors";
import { isPipelineId, type PipelineId } from "../../domain/pipeline";
import {
  defaultRuleState,
  type RuleEdit,
  type RuleSpec,
  type RuleState,
  type RuleVersion,
  type RuleView,
  validateRuleEdit,
} from "../../domain/rules";
import { RULE_SPECS } from "../../domain/rules/defaults";
import {
  changedParams,
  planRestore,
  sameRuleState,
} from "../../domain/skills/versions";
import { assertCan, RuleRefusedError } from "../errors";
import type { Actor, RuleRepository } from "../ports";

/** How long a Version's note may be. */
export const NOTE_CHARS = 500;

/** A note to save with a Version, trimmed; null when empty. */
export function cleanNote(note: string | null | undefined): string | null {
  const text = note?.trim();
  if (!text) return null;
  if (text.length > NOTE_CHARS) {
    throw new InvalidError(`The note is at most ${NOTE_CHARS} characters.`);
  }
  return text;
}

/**
 * Rules (ADR 0015): Defaults in code, edits as Versions. Only an admin
 * edits one (`rule.edit`); a bad edit is refused naming each field at
 * fault, and an edit that changes nothing is refused too. Every save is
 * audited with the Parameters it changed.
 */
export interface RuleService {
  /** Every Rule, or one Pipeline's (an unknown Pipeline is a 400). */
  list(actor: Actor, pipeline?: string | null): Promise<RuleView[]>;
  history(actor: Actor, ruleId: string): Promise<RuleVersion[]>;
  save(
    actor: Actor,
    ruleId: string,
    edit: RuleEdit,
    note?: string | null,
  ): Promise<RuleView>;
  /** Puts back the Default (no `version`) or an earlier Version, as a new Version. */
  restore(
    actor: Actor,
    ruleId: string,
    version?: number | null,
  ): Promise<RuleView>;
}

function specOf(ruleId: string): RuleSpec {
  const spec = RULE_SPECS.find((candidate) => candidate.id === ruleId);
  if (!spec) throw new NotFoundError("There is no such Rule.");
  return spec;
}

export function createRuleService(ports: {
  rules: RuleRepository;
}): RuleService {
  const { rules } = ports;

  return {
    list(actor, pipeline) {
      if (pipeline && !isPipelineId(pipeline)) {
        throw new InvalidError("There is no such Pipeline.");
      }
      return rules.list(actor.owner, (pipeline as PipelineId) || null);
    },

    history: (actor, ruleId) => rules.history(actor.owner, ruleId),

    save(actor, ruleId, edit, rawNote) {
      assertCan(actor.staff, "rule.edit");
      const spec = specOf(ruleId);
      const note = cleanNote(rawNote);
      return rules.saveVersion(
        actor.owner,
        spec.id,
        actor.staff.id,
        ({ current }) => {
          const result = validateRuleEdit(spec, edit, current);
          if (!result.ok) throw new RuleRefusedError(result.errors);
          if (sameRuleState(spec, result.next, current)) {
            throw new InvalidError(
              "Nothing changed: the Rule already says that.",
            );
          }
          return {
            state: result.next,
            note,
            event: (version) => ({
              owner: actor.owner,
              actor: { kind: "staff", staff: actor.staff },
              action: "rule.saved",
              summary: `Saved ${spec.title} as Version ${version}`,
              target: { kind: "rule", id: spec.id },
              detail: {
                pipelineId: spec.pipelineId,
                version,
                previousVersion: current.version,
                params: changedParams(spec, current.params, result.next.params),
                enabled: [current.enabled, result.next.enabled],
                outcome: [current.outcome, result.next.outcome],
                effectiveFrom: [
                  current.effectiveFrom,
                  result.next.effectiveFrom,
                ],
                note,
              },
            }),
          };
        },
      );
    },

    restore(actor, ruleId, version) {
      assertCan(actor.staff, "rule.edit");
      const spec = specOf(ruleId);
      return rules.saveVersion(
        actor.owner,
        spec.id,
        actor.staff.id,
        ({ current, versions }) => {
          const plan = planRestore<Omit<RuleState, "version">>(
            defaultRuleState(spec),
            versions,
            version,
          );
          if (!plan) throw new NotFoundError("That Version was never saved.");
          if (sameRuleState(spec, plan.state, current)) {
            throw new InvalidError(
              plan.from === null
                ? "The Rule already says what the Default says."
                : `The Rule already says what Version ${plan.from} says.`,
            );
          }
          return {
            state: plan.state,
            note: plan.note,
            event: (saved) => ({
              owner: actor.owner,
              actor: { kind: "staff", staff: actor.staff },
              action: "rule.restored",
              summary: `${plan.note} on ${spec.title} (now Version ${saved})`,
              target: { kind: "rule", id: spec.id },
              detail: {
                pipelineId: spec.pipelineId,
                version: saved,
                restoredFrom: plan.from === null ? "default" : plan.from,
                params: changedParams(spec, current.params, plan.state.params),
              },
            }),
          };
        },
      );
    },
  };
}
