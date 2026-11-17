import {
  MODELS,
  type ModelCall,
  type ModelId,
  PURPOSE_IDS,
  type Purpose,
} from "../domain/models";
import { STAGE_IDS, type StageId } from "../domain/run";

/*
 * Rolls a Run's model calls up by Stage and by purpose, for the Stage rail
 * and the Cost tab. A call records its purpose and a label, not its Stage, so
 * the Stage is read from both:
 *
 * - `watch` calls belong to Watch.
 * - A call about slides, the deck or a Round belongs to Design (`write`) or
 *   Check (`review`).
 * - A `write` call that repairs or fixes the Process belongs to Verify (the
 *   repair after the grounding review); any other `write` call to Extract.
 * - Any other `review` call belongs to Verify.
 */

const DECK_WORDS = /\b(slides?|deck|round)\b/i;
const REPAIR_WORDS = /\b(repair|fix|correct)/i;

export function stageOfCall(
  call: Pick<ModelCall, "purpose" | "label">,
): StageId {
  if (call.purpose === "watch") return "watch";
  const aboutDeck = DECK_WORDS.test(call.label);
  if (call.purpose === "write") {
    if (aboutDeck) return "design";
    return REPAIR_WORDS.test(call.label) ? "verify" : "extract";
  }
  return aboutDeck ? "check" : "verify";
}

/** The Round a call names ("Plan the slides (round 2)"), if any. */
export function roundOfCall(label: string): number | null {
  const match = /\bround\s+(\d+)/i.exec(label);
  return match ? Number(match[1]) : null;
}

export type CostLine = {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  /** Model ids, in the order first used. */
  models: string[];
};

const emptyLine = (): CostLine => ({
  calls: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  ms: 0,
  models: [],
});

function add(line: CostLine, call: ModelCall): CostLine {
  return {
    calls: line.calls + 1,
    costUsd: line.costUsd + call.costUsd,
    inputTokens: line.inputTokens + call.inputTokens,
    outputTokens: line.outputTokens + call.outputTokens,
    ms: line.ms + call.ms,
    models: line.models.includes(call.model)
      ? line.models
      : [...line.models, call.model],
  };
}

export function totalOf(calls: ModelCall[]): CostLine {
  return calls.reduce(add, emptyLine());
}

/** The latest pass over the Deck: 0 for the Run itself, n after its nth Redo. */
export function latestGeneration(calls: ModelCall[]): number {
  return calls.reduce((max, call) => Math.max(max, call.generation ?? 0), 0);
}

/**
 * Calls from before the latest Redo that the Stage rail leaves out. A Redo
 * runs Design and Check again, so their earlier calls would otherwise be
 * counted on the same two Stages twice. They are still real spend: the total
 * counts every call.
 */
export function earlierCalls(calls: ModelCall[]): ModelCall[] {
  const latest = latestGeneration(calls);
  return calls.filter((call) => isReplaced(call, latest));
}

/** A Design or Check call from before the latest Redo: its Rounds were replaced. */
export function isReplaced(
  call: Pick<ModelCall, "purpose" | "label" | "generation">,
  latest: number,
): boolean {
  const stage = stageOfCall(call);
  return (
    (stage === "design" || stage === "check") && (call.generation ?? 0) < latest
  );
}

/** Each Stage's calls in the latest pass (see `earlierCalls`). */
export function costByStage(calls: ModelCall[]): Record<StageId, CostLine> {
  const lines = Object.fromEntries(
    STAGE_IDS.map((id) => [id, emptyLine()]),
  ) as Record<StageId, CostLine>;
  const latest = latestGeneration(calls);
  for (const call of calls) {
    if (isReplaced(call, latest)) continue;
    const stage = stageOfCall(call);
    lines[stage] = add(lines[stage], call);
  }
  return lines;
}

export function costByPurpose(calls: ModelCall[]): Record<Purpose, CostLine> {
  const lines = Object.fromEntries(
    PURPOSE_IDS.map((id) => [id, emptyLine()]),
  ) as Record<Purpose, CostLine>;
  for (const call of calls) {
    if (!lines[call.purpose]) continue;
    lines[call.purpose] = add(lines[call.purpose], call);
  }
  return lines;
}

/** "Gemini 3.8 Flash" for a known id; the id itself otherwise. */
export function modelLabel(id: string): string {
  return MODELS[id as ModelId]?.label ?? id;
}
