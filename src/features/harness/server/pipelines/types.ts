import type { Owner } from "@/features/access/domain/owner";
import type { AuditUsage } from "../../domain/audit";
import type { ApprovalRisk } from "../../domain/permissions";
import type { PipelineId } from "../../domain/pipeline";
import type { FindingDraft, RuleStates } from "../../domain/pipelines/apply";
import type { Draft } from "../../domain/run";

/**
 * What a Run carries from Step to Step. Serialisable: the workflow hands it
 * to every step function. Fixed when the Run starts, so a replay of the
 * workflow sees the same date and the same Rule states.
 */
export type RunContext = {
  runId: string;
  owner: Owner;
  sessionId: string | null;
  pipelineId: PipelineId;
  input: Record<string, unknown>;
  /** The date the Run applies the Rules on (`YYYY-MM-DD`). */
  asOf: string;
  /** Model Steps use their fallbacks and spend nothing (the e2e suite). */
  stubbed: boolean;
  /** rule id → the state this Run applies (ADR 0015). */
  states: RuleStates;
  startedBy: { id: string; name: string };
};

/** Outputs of the Steps a Step waits for, near or far, by Step id. */
export type Deps = Record<string, unknown>;

/** What a Step worked out. */
export type StepResult = {
  /** Shown in the Pipeline view with the Step; must be plain JSON. */
  output: Record<string, unknown>;
  /** One line for the Audit trail. */
  summary: string;
  findings?: FindingDraft[];
  /** The Step had nothing to do (an earlier Finding made it unnecessary). */
  skipped?: boolean;
  usage?: AuditUsage | null;
};

export type Executor = (ctx: RunContext, deps: Deps) => Promise<StepResult>;

/** A Step that does one piece of work per item at the same time (a model call per paper). */
export type FanOut<Item, Value> = {
  /** The items, from the Step's inputs. Pure: the workflow calls it. */
  items: (ctx: RunContext, deps: Deps) => Item[];
  one: (
    ctx: RunContext,
    item: Item,
    deps: Deps,
  ) => Promise<{ value: Value; usage: AuditUsage | null; fallback: boolean }>;
  combine: (ctx: RunContext, values: Value[], deps: Deps) => StepResult;
};

/** What an Approval Step puts to a person, from the Step that drafted. */
export type ApprovalPlan = {
  kind: string;
  title: string;
  risk: ApprovalRisk;
  draft: Draft;
};

/** How a person (or the clock) settled an Approval; what the Steps after it read. */
export type ApprovalOutcome = {
  approvalId: string;
  decision: "approve" | "return" | "expired";
  note: string | null;
  decidedBy: { id: string; name: string } | null;
};

/** What `resumeHook` carries into the workflow when a person decides. */
export type ApprovalAnswer = {
  approvalId: string;
  decision: "approve" | "return";
  note: string | null;
  decidedBy: { id: string; name: string };
};

/** One Pipeline's server half: how each Step runs, what an Approval asks, what a Run returns. */
export type PipelineRunner = {
  steps: Record<string, Executor>;
  fanOut: Record<string, FanOut<unknown, unknown>>;
  approval: (ctx: RunContext, deps: Deps) => ApprovalPlan;
  result: (ctx: RunContext, outputs: Deps) => Record<string, unknown>;
};

/** A Step's output read back with its expected shape. Outputs travel as plain JSON between steps. */
export function outputOf<T>(deps: Deps, stepId: string): T {
  const value = deps[stepId];
  if (value === undefined) throw new Error(`Step "${stepId}" has not run`);
  return value as T;
}

/** A Step error a person should read as is (it names what to fix), not "something went wrong". */
export class StepProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepProblem";
  }
}
