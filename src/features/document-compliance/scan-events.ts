import type { FieldCheck } from "./domain/field-checks";
import type {
  DocumentJudgments,
  DocumentKind,
  FieldReading,
  Span,
} from "./domain/types";
import type { FindingView } from "./view";

export type ScanStage = "parse" | "read" | "check";

/**
 * What a Pre-screen run streams while it works, in the order it happens. The
 * run page animates and logs these; a replay rebuilds the same events from a
 * stored run, so a live run and a replay look alike.
 */
export type ScanEvent = { at: number } & (
  | {
      type: "stage";
      kind: DocumentKind;
      stage: ScanStage;
      state: "start" | "retry" | "done" | "error";
      attempt?: number;
      ms?: number;
      detail?: string;
    }
  | {
      type: "spans";
      kind: DocumentKind;
      parser: string;
      pageCount: number;
      spans: Pick<Span, "ref" | "page" | "text" | "box">[];
    }
  | { type: "field"; kind: DocumentKind; reading: FieldReading }
  | {
      type: "checks";
      kind: DocumentKind;
      checks: FieldCheck[];
      judgments: DocumentJudgments;
    }
  | { type: "findings"; findings: FindingView[] }
  | { type: "end"; status: "completed" | "failed"; error?: string }
);

/** The order Documents are shown in, one at a time. */
export const DOCUMENT_ORDER: DocumentKind[] = [
  "identity_document",
  "proof_of_address",
  "certified_copy",
];
