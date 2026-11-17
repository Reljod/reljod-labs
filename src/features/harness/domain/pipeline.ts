import type { ApprovalRisk } from "./permissions";

export const PIPELINE_IDS = [
  "member_request",
  "contribution_processing",
  "delinquency_report",
] as const;

/** Each Pipeline is one tool of the same name on the Harness MCP server. */
export type PipelineId = (typeof PIPELINE_IDS)[number];

export function isPipelineId(value: unknown): value is PipelineId {
  return (
    typeof value === "string" &&
    (PIPELINE_IDS as readonly string[]).includes(value)
  );
}

/**
 * A Step is code (a Rule check, a calculation, a lookup), a model call that
 * reads or drafts, or an Approval where the Run waits for a person. Only
 * code decides.
 */
export type StepKind = "code" | "model" | "approval";

export type StepSpec = {
  id: string;
  title: string;
  kind: StepKind;
  /** Steps that must finish first. Steps that share none run at the same time. */
  after: string[];
  /** One line on what the Step does, shown in the Pipeline view. */
  summary: string;
  /** For an Approval: who may give it (ADR 0014). */
  risk?: ApprovalRisk;
};

/** One field of a Pipeline's input, described plainly so a tool schema and a form can both be built from it. */
export type PipelineInputField = {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "month" | "id";
  required: boolean;
  description: string;
  /** For `string`: the allowed values. */
  options?: string[];
};

export type PipelineSpec = {
  id: PipelineId;
  title: string;
  summary: string;
  inputSchema: PipelineInputField[];
  steps: StepSpec[];
  /** The Skill that tells the Agent when and how to run it. */
  skillId: string;
  /** The Rulebook: the Skill that holds its Rules. */
  rulebookSkillId: string;
};

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

/** What is wrong with a Pipeline's Steps, or an empty list. */
export function pipelineProblems(spec: Pick<PipelineSpec, "steps">): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const step of spec.steps) {
    if (ids.has(step.id)) problems.push(`Step "${step.id}" is listed twice.`);
    ids.add(step.id);
  }
  for (const step of spec.steps) {
    for (const before of step.after) {
      if (before === step.id) {
        problems.push(`Step "${step.id}" waits for itself.`);
      } else if (!ids.has(before)) {
        problems.push(
          `Step "${step.id}" waits for "${before}", which is not a Step.`,
        );
      }
    }
  }
  if (problems.length === 0) {
    const cycle = findCycle(spec);
    if (cycle)
      problems.push(`Steps wait for each other: ${cycle.join(" → ")}.`);
  }
  return problems;
}

/** A loop of Steps that wait for each other, first Step repeated at the end, or null. */
export function findCycle(spec: Pick<PipelineSpec, "steps">): string[] | null {
  const after = new Map(spec.steps.map((step) => [step.id, step.after]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    const seen = state.get(id);
    if (seen === "done") return null;
    if (seen === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const before of after.get(id) ?? []) {
      if (!after.has(before)) continue;
      const cycle = visit(before);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };

  for (const step of spec.steps) {
    const cycle = visit(step.id);
    // Walked from a Step back to what it waits for, so reverse to read forwards.
    if (cycle) return cycle.reverse();
  }
  return null;
}

/**
 * The Steps in the order they can run: each level holds the Steps whose
 * `after` are all in earlier levels, so a level runs at the same time. Steps
 * keep their listed order within a level. Throws a PipelineError when the
 * Steps are not a valid graph.
 */
export function levels(spec: Pick<PipelineSpec, "steps">): StepSpec[][] {
  const problems = pipelineProblems(spec);
  if (problems.length > 0) throw new PipelineError(problems.join(" "));
  const placed = new Set<string>();
  const result: StepSpec[][] = [];
  let waiting = spec.steps;
  while (waiting.length > 0) {
    const level = waiting.filter((step) =>
      step.after.every((before) => placed.has(before)),
    );
    for (const step of level) placed.add(step.id);
    result.push(level);
    waiting = waiting.filter((step) => !placed.has(step.id));
  }
  return result;
}

/** Every Step that must finish before this one, near or far. */
export function upstream(
  spec: Pick<PipelineSpec, "steps">,
  stepId: string,
): string[] {
  const after = new Map(spec.steps.map((step) => [step.id, step.after]));
  const found = new Set<string>();
  const walk = (id: string) => {
    for (const before of after.get(id) ?? []) {
      if (found.has(before)) continue;
      found.add(before);
      walk(before);
    }
  };
  walk(stepId);
  return spec.steps.map((step) => step.id).filter((id) => found.has(id));
}
