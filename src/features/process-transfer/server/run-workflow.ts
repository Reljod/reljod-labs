import type { DeckRound, StageId } from "../domain/run";
import { pipeline } from "./pipeline-container";

/*
 * One Run as a durable workflow. Step and workflow names (and this file's
 * path) are replay keys: never rename or move them. Each step's work is the
 * pipeline service's (`services/pipeline.ts`), which reads what it needs
 * from the Run's row and writes what it made back (and streams it), so the
 * workflow itself only carries ids and the loop's next move. A stopped Run
 * ends quietly between stages. A Run the stubbed e2e suite started carries
 * `stub`, and its steps get the scripted Analyst from the same container.
 */

export type PipelineInput = {
  runId: string;
  owner: string;
  /** `full` runs every stage; `redo` runs Design, Check and Approve again. */
  mode: "full" | "redo";
  /** The site that started the Run: where a Sample is fetched from. */
  origin: string;
  /** The Run's `redos` when this pass started. */
  generation: number;
  /** Started by the stubbed e2e suite: no model is called. Absent on older Runs. */
  stub?: boolean;
};

const work = (input?: Pick<PipelineInput, "stub">) =>
  pipeline({ stub: input?.stub === true });

// Steps ----------------------------------------------------------------------------

async function beginStep(input: PipelineInput) {
  "use step";
  return work(input).begin(input);
}

/** Whether this pass should go on: not stopped, failed, replaced or gone. */
async function goingStep(runId: string, generation: number) {
  "use step";
  return work().going(runId, generation);
}

/**
 * The start of a Redo: the Process Checks run again under the Rules the Redo
 * took, so a Rule raised to block holds the Deck and one lowered no longer does.
 */
async function recheckStep(input: PipelineInput) {
  "use step";
  await work(input).recheck(input);
}

async function watchStep(input: PipelineInput) {
  "use step";
  await work(input).watch(input);
}
watchStep.maxRetries = 1;

async function extractStep(input: PipelineInput) {
  "use step";
  await work(input).extract(input);
}
extractStep.maxRetries = 1;

async function verifyStep(input: PipelineInput) {
  "use step";
  await work(input).verify(input);
}
verifyStep.maxRetries = 1;

async function documentStep(input: PipelineInput) {
  "use step";
  await work(input).document(input);
}

/** Design for one Round: plans the Deck and shows it before it is checked. */
async function designStep(
  input: PipelineInput,
  round: number,
  by: DeckRound["by"],
) {
  "use step";
  await work(input).design(input, round, by);
}
designStep.maxRetries = 1;

/** Check for one Round. Returns what the loop does next. */
async function checkStep(input: PipelineInput, round: number) {
  "use step";
  return work(input).check(input, round);
}
checkStep.maxRetries = 1;

async function approveStep(input: PipelineInput) {
  "use step";
  await work(input).approve(input);
}

async function failStep(input: PipelineInput, stage: StageId, raw: string) {
  "use step";
  await work(input).fail(input, stage, raw);
}

/** A Run someone stopped: the stream ends with it. */
async function stoppedStep() {
  "use step";
  await work().stopped();
}

// Orchestration --------------------------------------------------------------------

/** One Run: Watch → Extract → Verify → Document → (Design → Check)×Rounds → Approve. */
export async function processTransferRun(input: PipelineInput) {
  "use workflow";
  let stage: StageId = input.mode === "redo" ? "design" : "watch";
  const ended = { runId: input.runId, ended: false };
  try {
    if (!(await beginStep(input))) return ended;
    if (input.mode === "full") {
      for (const [id, run] of [
        ["watch", watchStep],
        ["extract", extractStep],
        ["verify", verifyStep],
        ["document", documentStep],
      ] as const) {
        if (!(await goingStep(input.runId, input.generation))) {
          await stoppedStep();
          return ended;
        }
        stage = id;
        await run(input);
      }
    } else {
      await recheckStep(input);
      // No model: a Redo of a Run stopped before it gets its document too.
      stage = "document";
      await documentStep(input);
    }
    let by: DeckRound["by"] = "draft";
    for (let round = 1; ; round++) {
      if (!(await goingStep(input.runId, input.generation))) {
        await stoppedStep();
        return ended;
      }
      stage = "design";
      await designStep(input, round, by);
      stage = "check";
      const move = await checkStep(input, round);
      if (move === "approve" || move === "hold") break;
      by = move === "auto-fit" ? "auto-fit" : "revision";
    }
    stage = "approve";
    await approveStep(input);
    return { runId: input.runId, ended: true };
  } catch (error) {
    await failStep(
      input,
      stage,
      error instanceof Error ? error.message : String(error),
    );
    return ended;
  }
}
