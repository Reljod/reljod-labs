import "server-only";
import type { Purpose, RunEventInput, RunStatus } from "../domain/contract";
import {
  endRunIfGoing,
  insertEvents,
  type RunRow,
  recordModelCall,
  runStatus,
  updateRun,
} from "./repository";

export type ModelCallRecord = {
  runId: string;
  purpose: Purpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
};

/**
 * Where a Run's Audit trail goes. The app writes it to Supabase
 * (`name_extraction.run_events`), and the events route streams it from there.
 * The eval script swaps in its own sink, so it runs without a database.
 */
export type RunSink = {
  events(
    runId: string,
    events: (RunEventInput & { at: number })[],
  ): Promise<void>;
  modelCall(record: ModelCallRecord): Promise<void>;
  /** The Run row's status, read between turns so a stop is seen. */
  status(runId: string): Promise<RunStatus | null>;
  update(
    runId: string,
    patch: Partial<Pick<RunRow, "status" | "cost_usd">>,
  ): Promise<void>;
  /** Ends a Run still going; a Run already ended (stopped) keeps its status. */
  end(
    runId: string,
    patch: Partial<
      Pick<RunRow, "status" | "error" | "names" | "score" | "cost_usd">
    >,
  ): Promise<void>;
};

const databaseSink: RunSink = {
  events: (runId, events) => insertEvents(runId, events),
  modelCall: (record) => recordModelCall(record),
  status: (runId) => runStatus(runId),
  update: (runId, patch) => updateRun(runId, patch),
  end: (runId, patch) => endRunIfGoing(runId, patch),
};

/** The current sink, for the workflow's own reads and writes of the Run row. */
export function runSink() {
  return sink;
}

let sink: RunSink = databaseSink;

/** For the eval script only: send the trail somewhere other than the database. */
export function setRunSink(next: RunSink) {
  sink = next;
}

function stamp(events: RunEventInput[]) {
  const at = Date.now();
  return events.map((event) => ({ ...event, at }));
}

/**
 * Appends events to the Run's Audit trail. Best effort: the work an event
 * records has already happened, and failing the Run because the trail's
 * insert failed would lose the work and still not record it. Outside
 * production it throws, so a schema drift is seen at once.
 */
export async function emit(runId: string, ...events: RunEventInput[]) {
  try {
    await sink.events(runId, stamp(events));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") throw error;
    console.error(
      "[name-extraction] event write failed",
      events.map((event) => event.type).join(","),
      error,
    );
  }
}

/**
 * Appends events and throws if it cannot, in production too. For work that
 * must not happen untraced (code the Analyst wrote): write first, and do the
 * work only if this returned (ADR 0019).
 */
export async function emitStrict(runId: string, ...events: RunEventInput[]) {
  await sink.events(runId, stamp(events));
}

/** Records one model call's tokens and price. Never fails the call it measures. */
export async function recordCall(record: ModelCallRecord) {
  try {
    await sink.modelCall(record);
  } catch (error) {
    console.error("[name-extraction] model call record failed", error);
  }
}
