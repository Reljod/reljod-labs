import type { StageId, StageStatus } from "../../domain/run";

export type ResultTab = "steps" | "document" | "deck" | "cost";

/** Ids of the sections a Stage's results are shown in. */
export const RESULT_ANCHOR = {
  results: "ho-results",
  transcript: "ho-transcript",
  steps: "ho-steps",
  processChecks: "ho-process-checks",
} as const;

/**
 * Where a Stage's results are on the Run screen: the result tab, and the
 * section in it to scroll to. Watch wrote the transcript, Extract the Steps,
 * Verify the Process Checks; Document, Design, Check and Approve each live
 * in a tab of their own.
 */
export function stageResults(stage: StageId): {
  tab: ResultTab;
  anchor: string;
} {
  switch (stage) {
    case "watch":
      return { tab: "steps", anchor: RESULT_ANCHOR.transcript };
    case "extract":
      return { tab: "steps", anchor: RESULT_ANCHOR.steps };
    case "verify":
      return { tab: "steps", anchor: RESULT_ANCHOR.processChecks };
    case "document":
      return { tab: "document", anchor: RESULT_ANCHOR.results };
    case "design":
    case "check":
    case "approve":
      return { tab: "deck", anchor: RESULT_ANCHOR.results };
  }
}

/** A Stage that has not started has nothing to show yet. */
export function hasResults(status: StageStatus): boolean {
  return status === "done" || status === "running" || status === "failed";
}
