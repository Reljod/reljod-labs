import "server-only";
import { LIMITS } from "../../domain/limits";
import type { ModelChoice } from "../../domain/models";
import { type Process, processSchema, type Watch } from "../../domain/process";
import { checkProcess, groundedCheck } from "../../domain/process-checks";
import {
  blocking,
  type CheckResult,
  type ReviewFinding,
  type RuleSet,
  reviewSchema,
} from "../../domain/rules";
import { RunError } from "../errors";
import { generate, type RunContext } from "../llm";
import type { Verified } from "../ports";
import {
  extractInstructions,
  extractPrompt,
  GROUND_INSTRUCTIONS,
  groundPrompt,
  repairPrompt,
} from "../prompts";

/**
 * Step ids in order (s1, s2, ...), whatever the model called them. Step
 * times are kept as the model gave them: a time outside the Recording is
 * what Rule `process.step-has-evidence` exists to catch, and the repair to fix.
 */
function cleanProcess(process: Process): Process {
  if (process.steps.length > LIMITS.maxSteps) {
    throw new RunError(
      `This Recording describes more than ${LIMITS.maxSteps} steps; split it into shorter calls.`,
    );
  }
  return {
    ...process,
    steps: process.steps.map((step, index) => ({
      ...step,
      id: `s${index + 1}`,
    })),
  };
}

/** The Extract stage: the Write model turns the Watch into a Process. */
export async function extractProcess(
  ctx: RunContext,
  input: { watch: Watch; rules: RuleSet; models: ModelChoice },
): Promise<Process> {
  const process = await generate(ctx, {
    purpose: "write",
    label: "Write the Process",
    model: input.models.write,
    schema: processSchema,
    instructions: extractInstructions(input.rules),
    content: extractPrompt(input.watch),
    maxOutputTokens: 16_000,
  });
  return cleanProcess(process);
}

async function ground(
  ctx: RunContext,
  input: { process: Process; watch: Watch; models: ModelChoice },
  label: string,
): Promise<ReviewFinding[]> {
  const review = await generate(ctx, {
    purpose: "review",
    label,
    model: input.models.review,
    schema: reviewSchema,
    instructions: GROUND_INSTRUCTIONS,
    content: groundPrompt(input.process, input.watch),
    maxOutputTokens: 8_000,
  });
  return review.findings.slice(0, 30);
}

export function allChecks(
  process: Process,
  watch: Watch,
  rules: RuleSet,
  findings: ReviewFinding[] | null,
): CheckResult[] {
  const checks = checkProcess(process, watch, rules);
  const grounded =
    findings === null
      ? null
      : groundedCheck(findings, rules.get("process.grounded"));
  return grounded ? [...checks, grounded] : checks;
}

/**
 * The Verify stage: Process Rules, then the Review model grounds every step
 * in the Watch. Anything blocking gets one repair by the Write model, and
 * the Checks and the grounding run again on the repaired Process. The Run
 * goes on either way.
 */
export async function verifyProcess(
  ctx: RunContext,
  input: {
    process: Process;
    watch: Watch;
    rules: RuleSet;
    models: ModelChoice;
  },
  note: (text: string) => Promise<void>,
): Promise<Verified> {
  const { watch, rules, models } = input;
  const grounding = rules.get("process.grounded")?.enabled ?? false;
  const findings = grounding
    ? await ground(ctx, input, "Check the steps against the Recording")
    : [];
  const checks = allChecks(
    input.process,
    watch,
    rules,
    grounding ? findings : null,
  );
  const failed = blocking(checks);
  if (failed.length === 0) {
    return { process: input.process, checks, findings, repaired: false };
  }
  await note(
    `${failed.length} blocking Check${failed.length === 1 ? "" : "s"} failed; sending the Process back for one repair`,
  );
  const repaired = cleanProcess(
    await generate(ctx, {
      purpose: "write",
      label: "Repair the Process",
      model: models.write,
      schema: processSchema,
      instructions: extractInstructions(rules),
      content: repairPrompt({
        process: input.process,
        watch,
        checks: failed,
        findings: findings.filter((item) => item.severity === "major"),
      }),
      maxOutputTokens: 16_000,
    }),
  );
  // The repaired Process is new text: its steps are grounded again, whatever
  // Check sent it back, so the grounding never speaks for steps nobody read.
  const after = grounding
    ? await ground(
        ctx,
        { process: repaired, watch, models },
        "Check the repaired steps",
      )
    : [];
  return {
    process: repaired,
    checks: allChecks(repaired, watch, rules, grounding ? after : null),
    findings,
    repaired: true,
  };
}
