import type { DraftGraph, Extraction, Issue } from "../domain/graph";
import type { GatheredSource } from "./gather";
import type { BuildInput } from "./ports";
import { buildWork } from "./work-container";

export type { BuildInput };

/*
 * Step and workflow names (and this file's path) are replay keys: never
 * rename or move them. Each step's body does its work through the Build
 * work service (`services/build-work.ts`); a Build a stubbed e2e request
 * started (`input.stub`) gets the canned models from the same container.
 */
const work = (input: Pick<BuildInput, "stub">) =>
  buildWork({ stub: input.stub === true });

/** Review rounds: check, critique, repair; then again if the Critic changed anything. */
export const MAX_ROUNDS = 2;

// Steps --------------------------------------------------------------------------

async function gatherStep(input: BuildInput): Promise<{
  clientName: string;
  sources: GatheredSource[];
  base: DraftGraph;
}> {
  "use step";
  return work(input).gather(input);
}
gatherStep.maxRetries = 1;

async function extractStep(
  input: BuildInput,
  clientName: string,
  source: GatheredSource,
  known: string,
): Promise<Extraction> {
  "use step";
  return work(input).extract(input, clientName, source, known);
}
extractStep.maxRetries = 2;

/** Joins every Source's facts in a fixed order, so a retry merges the same way. */
async function mergeStep(
  base: DraftGraph,
  sources: GatheredSource[],
  extractions: Extraction[],
  started: number,
): Promise<DraftGraph> {
  "use step";
  // Pure code and the event stream: no model, so either container will do.
  return work({}).merge(base, sources, extractions, started);
}

/** Code's own checks, then the fixes code can make without asking. */
async function checkStep(
  input: BuildInput,
  graph: DraftGraph,
  sources: GatheredSource[],
  round: number,
): Promise<{ graph: DraftGraph; issues: Issue[]; applied: number }> {
  "use step";
  return work(input).check(input, graph, sources, round);
}

async function critiqueStep(
  input: BuildInput,
  clientName: string,
  graph: DraftGraph,
  sources: GatheredSource[],
  issues: Issue[],
  round: number,
  earlier: string[],
): Promise<{
  graph: DraftGraph;
  verdict: "clean" | "needs_changes";
  applied: string[];
}> {
  "use step";
  return work(input).critique(
    input,
    clientName,
    graph,
    sources,
    issues,
    round,
    earlier,
  );
}

/**
 * The last word: reconnect anything a Repair left floating, and drop facts no
 * Source supports that the Critic didn't vouch for.
 */
async function settleStep(
  input: BuildInput,
  graph: DraftGraph,
  sources: GatheredSource[],
  round: number,
): Promise<{ graph: DraftGraph; applied: number }> {
  "use step";
  return work(input).settle(input, graph, sources, round);
}

async function commitStep(input: BuildInput, graph: DraftGraph): Promise<void> {
  "use step";
  await work(input).commit(input, graph);
}
commitStep.maxRetries = 2;

async function embedStep(input: BuildInput): Promise<void> {
  "use step";
  await work(input).embed(input);
}
embedStep.maxRetries = 2;

async function personaStep(
  input: BuildInput,
  clientName: string,
  graph: DraftGraph,
): Promise<void> {
  "use step";
  await work(input).persona(input, clientName, graph);
}
personaStep.maxRetries = 1;

async function finishStep(
  input: BuildInput,
  graph: DraftGraph,
  rounds: number,
  repairs: number,
): Promise<void> {
  "use step";
  await work(input).finish(input, graph, rounds, repairs);
}

async function failStep(input: BuildInput, message: string): Promise<void> {
  "use step";
  await work(input).fail(input, message);
}

// Workflow ------------------------------------------------------------------------

/**
 * Turns a Build's Sources into the Client graph: Gather, Extract each Source
 * in parallel, then up to two review rounds (Check, Critique, Repair) before
 * committing, embedding and inferring the Persona.
 */
export async function buildWorkflow(input: BuildInput) {
  "use workflow";
  try {
    const gathered = await gatherStep(input);
    const known =
      input.trigger === "addition"
        ? gathered.base.nodes
            .slice(0, 200)
            .map((node) => `${node.key} | ${node.label} | ${node.category}`)
            .join("\n")
        : "";
    const extractStarted = Date.now();
    const extractions = await Promise.all(
      gathered.sources.map((source) =>
        extractStep(input, gathered.clientName, source, known),
      ),
    );
    let graph = await mergeStep(
      gathered.base,
      gathered.sources,
      extractions,
      extractStarted,
    );

    let repairs = 0;
    let rounds = 0;
    const earlier: string[] = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      rounds = round;
      const checked = await checkStep(input, graph, gathered.sources, round);
      const reviewed = await critiqueStep(
        input,
        gathered.clientName,
        checked.graph,
        gathered.sources,
        checked.issues,
        round,
        earlier,
      );
      graph = reviewed.graph;
      repairs += checked.applied + reviewed.applied.length;
      earlier.push(...reviewed.applied);
      if (reviewed.verdict === "clean" || reviewed.applied.length === 0) break;
    }
    const settled = await settleStep(input, graph, gathered.sources, rounds);
    graph = settled.graph;
    repairs += settled.applied;

    await commitStep(input, graph);
    await embedStep(input);
    await personaStep(input, gathered.clientName, graph);
    await finishStep(input, graph, rounds, repairs);
  } catch (error) {
    await failStep(
      input,
      error instanceof Error ? error.message : String(error),
    );
  }
}
