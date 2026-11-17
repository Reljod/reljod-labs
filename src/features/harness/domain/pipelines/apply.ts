import type { PipelineId } from "../pipeline";
import {
  defaultRuleState,
  type ParameterValue,
  type RuleParams,
  type RuleSpec,
  type RuleState,
} from "../rules";
import { RULE_SPECS } from "../rules/defaults";
import type { Finding } from "../run";

/** What a check concluded: met or not, one line on why, and the values it compared. */
export type CheckResult = {
  met: boolean;
  summary: string;
  compared: Record<string, unknown>;
};

/**
 * A Rule's check: pure code over the case facts and the Rule's Parameters
 * (ADR 0015). Null when the Rule does not apply to this case (a property
 * Rule on a transfer), so no Finding is made.
 */
export type Check<Facts> = (
  facts: Facts,
  params: RuleParams,
) => CheckResult | null;

/** A Finding before it is saved: the database gives it its id and time. */
export type FindingDraft = Omit<Finding, "id" | "createdAt">;

/** rule id → the state a Run applies. */
export type RuleStates = Record<string, RuleState>;

/**
 * The states a Run applies to one Pipeline's Rules: what the Workspace has
 * saved laid over the Defaults. A Rule with no saved state is at its Default
 * (Version 0); a saved state that names no known Rule is ignored.
 */
export function resolveRuleStates(
  pipelineId: PipelineId,
  saved: Record<string, RuleState> | null,
  specs: RuleSpec[] = RULE_SPECS,
): RuleStates {
  const states: RuleStates = {};
  for (const spec of specs) {
    if (spec.pipelineId !== pipelineId) continue;
    const state = saved?.[spec.id];
    states[spec.id] = state
      ? { ...state, params: { ...spec.defaults, ...state.params } }
      : defaultRuleState(spec);
  }
  return states;
}

/** rule id → Version, what `runs.rule_versions` keeps. */
export function ruleVersionsOf(states: RuleStates): Record<string, number> {
  return Object.fromEntries(
    Object.entries(states).map(([id, state]) => [id, state.version]),
  );
}

/**
 * Runs one Step's checks. A Rule is applied when it belongs to the Step, has
 * a check, is switched on and took effect on or before `asOf`; each applied
 * Rule that has something to say gives one Finding carrying its Version and
 * Outcome. Pure: the same facts and states give the same Findings.
 */
export function applyChecks<Facts>(input: {
  pipelineId: PipelineId;
  stepId: string;
  checks: Record<string, Check<Facts>>;
  facts: Facts;
  states: RuleStates;
  asOf: string;
  specs?: RuleSpec[];
}): FindingDraft[] {
  const specs = input.specs ?? RULE_SPECS;
  const findings: FindingDraft[] = [];
  for (const spec of specs) {
    if (spec.pipelineId !== input.pipelineId || spec.stepId !== input.stepId)
      continue;
    const check = input.checks[spec.id];
    if (!check) continue;
    const state = input.states[spec.id] ?? defaultRuleState(spec);
    if (!state.enabled || state.effectiveFrom > input.asOf) continue;
    const result = check(input.facts, { ...spec.defaults, ...state.params });
    if (!result) continue;
    findings.push({
      ruleId: spec.id,
      ruleVersion: state.version,
      stepId: input.stepId,
      met: result.met,
      outcome: state.outcome,
      summary: result.summary,
      compared: result.compared,
    });
  }
  return findings;
}

/** Findings that stop or hold a case: not met, with an Outcome of `block` or `refer`. */
export function biting(findings: FindingDraft[]): FindingDraft[] {
  return findings.filter(
    (finding) => !finding.met && finding.outcome !== "warn",
  );
}

/** A Parameter read as a number, falling back when it is missing or not a number. */
export function num(params: RuleParams, name: string, fallback = 0): number {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A Parameter read as a list of strings. */
export function list(params: RuleParams, name: string): string[] {
  const value: ParameterValue | undefined = params[name];
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

/** A Parameter of another Rule, as the Run applies it (a check that needs the cap, say). */
export function paramOf(
  states: RuleStates,
  ruleId: string,
  name: string,
  specs: RuleSpec[] = RULE_SPECS,
): ParameterValue | undefined {
  const state = states[ruleId];
  if (state && name in state.params) return state.params[name];
  return specs.find((spec) => spec.id === ruleId)?.defaults[name];
}
