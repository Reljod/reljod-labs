import type { DocumentKind } from "../document-kinds";
import type { Check, RunState } from "../run-state";

/** What a deterministic Job hands back: Checks, a patch to the state and a line for the log. */
export type JobOutcome = {
  checks: Check[];
  patch?: Partial<RunState>;
  summary: string;
  /** A finding only the human can resolve, such as a name change with no evidence. */
  question?: { prompt: string; kinds: DocumentKind[] };
};
