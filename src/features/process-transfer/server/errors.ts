import type { StageId } from "../domain/run";

/*
 * What a person reads when a stage fails. Messages written for people are
 * thrown as `RunError`; anything else (a provider's or the database's own
 * text) is logged on the server and replaced by the stage's plain message,
 * so raw errors never reach the row, the stream or the Audit trail.
 */

/** Marks a message as written for people; survives the trip through the workflow's error serialisation. */
const MARK = "[for-people] ";

/**
 * The marker only counts at the very start of the message (after an
 * optional `SomeError: ` the runtime may put in front), so text a model
 * wrote that ends up inside another error cannot pass itself off as ours.
 */
const MARKED = /^(?:[A-Za-z]*Error: )?\[for-people\] /;

export class RunError extends Error {
  constructor(message: string) {
    super(`${MARK}${message}`);
    this.name = "RunError";
  }
}

const STAGE_FAILURE: Record<StageId, string> = {
  watch: "The model could not watch the Recording. Try again in a moment.",
  extract: "The model could not write a Process from the Recording. Try again.",
  verify: "The Process could not be checked. Try again.",
  document: "The workflow document could not be laid out.",
  design: "The slides could not be planned. Try again.",
  check: "The slides could not be checked. Try again.",
  approve: "The Deck could not be approved or held. Try again.",
};

/** The message to keep for a stage that failed with `raw`. */
export function stageFailure(stage: StageId, raw: string): string {
  const match = MARKED.exec(raw);
  if (match) return raw.slice(match[0].length).slice(0, 500);
  console.error(`[process-transfer] ${stage} failed:`, raw);
  return STAGE_FAILURE[stage];
}
