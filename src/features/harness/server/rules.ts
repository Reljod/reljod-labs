import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { PipelineId } from "../domain/pipeline";
import type {
  RuleEdit,
  RuleState,
  RuleVersion,
  RuleView,
} from "../domain/rules";
import type { Actor } from "./actor";
import { NotBuiltError } from "./errors";

/*
 * STUB. Owned by the Skills slice, which replaces every body here and keeps
 * the signatures. Rules are data (ADR 0015): `RULE_SPECS` in
 * `domain/rules/defaults.ts` are the Defaults, and `harness.rule_versions`
 * holds a Workspace's edits. No row for a Rule means its Default (Version 0).
 */

/** Every Rule as the Workspace has it now, in spec order; one Pipeline's when given. */
export async function listRules(
  _owner: Owner,
  _pipelineId?: PipelineId | null,
): Promise<RuleView[]> {
  throw new NotBuiltError("skills");
}

/**
 * rule id → the state in force, for every Rule in `RULE_SPECS`. `startRun`
 * snapshots the Versions from this, and a Pipeline's checks read their
 * Parameters from it.
 */
export async function currentRuleStates(
  _owner: Owner,
): Promise<Record<string, RuleState>> {
  throw new NotBuiltError("skills");
}

/**
 * Saves an edit as the Rule's next Version.
 *
 * Must: check `can(staff, "rule.edit")`; run `validateRuleEdit(spec, edit,
 * current)` and throw `RuleRefusedError(errors)` when it fails; insert
 * Version n+1 (never update a row) and write `rule.saved` in the same
 * transaction (`auditIn`), with the Parameters that changed in the detail.
 */
export async function saveRule(
  _input: Actor & { ruleId: string; edit: RuleEdit; note?: string | null },
): Promise<RuleView> {
  throw new NotBuiltError("skills");
}

/**
 * Puts a Rule back to its Default (`version` left out or 0) or to an earlier
 * Version, by saving that state as a new Version. Checks `can(staff,
 * "rule.edit")` and writes `rule.restored`.
 */
export async function restoreRule(
  _input: Actor & { ruleId: string; version?: number | null },
): Promise<RuleView> {
  throw new NotBuiltError("skills");
}

/** A Rule's saved Versions, newest first. Empty while only the Default applies. */
export async function ruleHistory(
  _owner: Owner,
  _ruleId: string,
): Promise<RuleVersion[]> {
  throw new NotBuiltError("skills");
}
