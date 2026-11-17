import "server-only";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_RULEBOOK,
  type ModelChoice,
  type RunEvent,
  type RunStatus,
  type Score,
} from "../domain/contract";
import { corpusCards } from "../domain/corpus";
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
};

/**
 * Runs the Analyst over one Corpus Document in this process, with no
 * database: the trail goes to `onEvent`, model calls are summed here. The
 * workflow function runs as plain code (steps are ordinary calls when the
 * workflow compiler is not involved). For scripts/eval-name-extraction.mts
 * only; it spends real money.
 */
export async function evaluateCorpus(
  corpusId: string,
  models: ModelChoice,
  onEvent: (event: RunEvent) => void = () => {},
): Promise<EvalResult> {
  const card = corpusCards().find((item) => item.id === corpusId);
  if (!card) throw new Error(`Unknown corpus document: ${corpusId}`);
  const calls: ModelCallRecord[] = [];
  let status: RunStatus = "queued";
  let names = 0;
  let error: string | undefined;
  setRunSink({
    events: async (_runId, events) => {
      for (const event of events) onEvent(event as RunEvent);
    },
    modelCall: async (record) => {
      calls.push(record);
    },
    status: async () => status,
    update: async (_runId, patch) => {
      if (patch.status) status = patch.status;
    },
    end: async (_runId, patch) => {
      if (patch.status) status = patch.status;
      if (Array.isArray(patch.names)) names = patch.names.length;
      if (patch.error) error = patch.error;
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
  return {
    corpusId,
    title: card.title,
    pages: card.pages,
    status,
    score: outcome.score ?? null,
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    ms: Date.now() - started,
    analystCalls: calls.filter((call) => call.purpose === "analyst").length,
    readerCalls: calls.filter((call) => call.purpose === "reader").length,
    names,
    ...(error ? { error } : {}),
  };
}
