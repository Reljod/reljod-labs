import type { RuleSpec } from "../rules";

/**
 * Owned by the Pipelines slice. Every Rule a Pipeline checks, with its
 * sentence, Parameters, default values, Outcome, citation and effective date
 * (ADR 0015). Empty until that slice lands.
 */
export const RULE_SPECS: RuleSpec[] = [];
