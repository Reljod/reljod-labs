import "server-only";
import { randomUUID } from "node:crypto";
import { compareNames } from "../domain/compare";
import {
  DEFAULT_RULEBOOK,
  type ExtractedName,
  type ModelChoice,
  type Replay,
  type RunEvent,
  type RunStatus,
  type Score,
} from "../domain/contract";
import {
  answerKeyFor,
  corpusCards,
  generateDocumentDetailed,
} from "../domain/corpus";
import { slimEvents } from "../domain/replay";
import { type ModelCallRecord, setRunSink } from "./emit";
import { nameExtractionRun } from "./run-workflow";

export type EvalResult = {
  corpusId: string;
  title: string;
  pages: number;
  status: RunStatus;
  score: Score | null;
  costUsd: number;
  ms: number;
  analystCalls: number;
  readerCalls: number;
  names: number;
  error?: string;
  /** With `record`: the Run as a Replay for public/name-extraction/replays. */
  replay?: Replay;
};

/**
 * Runs the Analyst over one Corpus Document in this process, with no
 * database: the trail goes to `onEvent`, model calls are summed here. The
 * workflow function runs as plain code (steps are ordinary calls when the
 * workflow compiler is not involved). For scripts/eval-name-extraction.mts
 * only; it spends real money. With `record`, the result carries a Replay.
 */
export async function evaluateCorpus(
  corpusId: string,
  models: ModelChoice,
  onEvent: (event: RunEvent) => void = () => {},
  options: { record?: boolean } = {},
): Promise<EvalResult> {
  const card = corpusCards().find((item) => item.id === corpusId);
  if (!card) throw new Error(`Unknown corpus document: ${corpusId}`);
  const calls: ModelCallRecord[] = [];
  let status: RunStatus = "queued";
  let register: ExtractedName[] = [];
  let error: string | undefined;
  const trail: (RunEvent & { seq: number })[] = [];
  setRunSink({
    events: async (_runId, events) => {
      for (const event of events) {
        if (options.record)
          trail.push({ ...(event as RunEvent), seq: trail.length + 1 });
        onEvent(event as RunEvent);
      }
    },
    modelCall: async (record) => {
      calls.push(record);
    },
    status: async () => status,
    update: async (_runId, patch) => {
      if (patch.status) status = patch.status;
    },
    end: async (_runId, patch) => {
      if (status !== "queued" && status !== "running") return false;
      if (patch.status) status = patch.status;
      if (Array.isArray(patch.names)) register = patch.names;
      if (patch.error) error = patch.error;
      return true;
    },
  });
  const started = Date.now();
  const outcome = await nameExtractionRun({
    ctx: {
      runId: randomUUID(),
      source: { kind: "corpus", corpusId },
      title: card.title,
      pages: card.pages,
      models,
      rulebook: DEFAULT_RULEBOOK,
      rulebookVersion: 0,
    },
  });
  const ms = Date.now() - started;
  const costUsd = calls.reduce((sum, call) => sum + call.costUsd, 0);
  return {
    corpusId,
    title: card.title,
    pages: card.pages,
    status,
    score: outcome.score ?? null,
    costUsd,
    ms,
    analystCalls: calls.filter((call) => call.purpose === "analyst").length,
    readerCalls: calls.filter((call) => call.purpose === "reader").length,
    names: register.length,
    ...(error ? { error } : {}),
    ...(options.record
      ? {
          replay: replayOf(corpusId, models, trail, register, costUsd, ms),
        }
      : {}),
  };
}

/** A recorded Run as the page plays it: slimmed trail, final Register, comparison. */
function replayOf(
  corpusId: string,
  models: ModelChoice,
  trail: (RunEvent & { seq: number })[],
  names: ExtractedName[],
  costUsd: number,
  durationMs: number,
): Replay {
  const card = corpusCards().find((item) => item.id === corpusId);
  if (!card) throw new Error(`Unknown corpus document: ${corpusId}`);
  const { answerKey, hard } = generateDocumentDetailed(corpusId);
  return {
    corpusId,
    title: card.title,
    genre: card.genre,
    pages: card.pages,
    models,
    durationMs,
    costUsd,
    events: slimEvents(trail),
    names,
    comparison: compareNames(
      names,
      answerKeyFor(answerKey, DEFAULT_RULEBOOK),
      new Map(hard.map((party) => [party.canonical, party.kind] as const)),
    ),
    recordedAt: new Date().toISOString(),
  };
}
