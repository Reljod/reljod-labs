import type { FieldCheck } from "./domain/field-checks";
import type { ReviewView } from "./domain/review";
import type { RequirementId, Rulebook } from "./domain/rulebook";
import type { AppliedRule, RuleId, RuleState } from "./domain/rules";
import type {
  Box,
  DocumentJudgments,
  DocumentKind,
  ExtractedDocument,
  FieldName,
  Finding,
  Outcome,
} from "./domain/types";
import type { DocumentMetrics } from "./metrics";

/** Everything the Reviewer view needs to show one Pre-screen run. */
export type RunView = {
  id: string;
  packSlug: string;
  status:
    | "queued"
    | "parsing"
    | "extracting"
    | "evaluating"
    | "completed"
    | "failed";
  error: string | null;
  model: string | null;
  createdAt: string;
  completedAt: string | null;
  prescreenDate: string;
  documents: DocumentView[];
  /** The Findings the run itself made: Evaluation 1. */
  findings: FindingView[];
  /** Evaluation 1 (the run's own), then each re-evaluation, oldest first. */
  evaluations: EvaluationView[];
  /** Every Reviewer decision, oldest first; the newest per Requirement stands. */
  reviews: ReviewView[];
};

/** One evaluation of a run's Rulebook over its stored readings. */
export type EvaluationView = {
  number: number;
  createdAt: string;
  /** Who asked for it; null for the run's own. */
  createdBy: string | null;
  /** Every Rule as this evaluation applied it. */
  rules: AppliedRule[];
  findings: FindingView[];
  /** The Field checks under these Rules, every Document together. */
  checks: FieldCheck[];
};

/** A Rule as the Owner has it now, for the Rules page. */
export type RuleView = {
  id: RuleId;
  state: RuleState;
  /** True when it differs from the Default. */
  edited: boolean;
  savedBy: string | null;
  savedAt: string | null;
  versionCount: number;
};

/** One saved state of a Rule; Version 0 is the Default. */
export type RuleVersionView = RuleState & {
  restoredFrom: number | null;
  savedBy: string;
  savedAt: string | null;
};

export type DocumentView = {
  kind: DocumentKind;
  parser: string;
  pageCount: number;
  pages: { page: number; imageUrl: string }[];
  spans: {
    ref: string;
    page: number;
    text: string;
    box: Box;
    /** The OCR engine's confidence; null for a PDF text layer. */
    confidence: number | null;
  }[];
  fields: {
    name: FieldName;
    value: string;
    verified: boolean;
    confidence: number | null;
    spanRefs: string[];
  }[];
  checks: FieldCheck[];
  judgments: DocumentJudgments;
  /** Null for a Document saved before run metrics were kept. */
  metrics: DocumentMetrics | null;
  /** The model's structured answer exactly as returned, when it was kept. */
  raw: unknown;
};

/** Whether a run has stopped: completed or failed, never to change again. */
export const isFinished = (status: RunView["status"]) =>
  status === "completed" || status === "failed";

/** One run in the visitor's Session list. */
export type SessionRunView = {
  id: string;
  packSlug: string;
  status: RunView["status"];
  createdAt: string;
  completedAt: string | null;
  model: string | null;
  costUsd: number | null;
  tokens: number;
  counts: Record<Outcome, number>;
};

export type FindingView = {
  requirementId: RequirementId;
  title: string;
  outcome: Outcome;
  reason: string;
  evidence: {
    documentKind: DocumentKind;
    fieldName: FieldName | null;
    spanRefs: string[];
  }[];
};

export type StartResult =
  | { status: "started"; runId: string }
  | { status: "limited"; runId: string | null; message: string }
  /** Starting failed on the server; the cause is in the server logs. */
  | { status: "error"; message: string };

/** A stored Document as evaluation reads it: its fields and the model's judgments. */
export function asExtracted(
  document: Pick<DocumentView, "kind" | "fields" | "judgments">,
): ExtractedDocument {
  return {
    kind: document.kind,
    spans: [],
    fields: document.fields.map((field) => ({
      name: field.name,
      value: field.value,
      spanRefs: field.spanRefs,
      verified: field.verified,
      confidence: field.confidence ?? 0,
    })),
    judgments: document.judgments,
  };
}

/** Shapes the Findings an evaluation just produced, in Rulebook order. */
export function findingViews(
  rulebook: Rulebook,
  findings: Finding[],
): FindingView[] {
  return rulebook.requirements.flatMap((requirement) => {
    const finding = findings.find(
      (item) => item.requirementId === requirement.id,
    );
    return finding
      ? [
          {
            requirementId: requirement.id,
            title: requirement.title,
            outcome: finding.outcome,
            reason: finding.reason,
            evidence: finding.evidence,
          },
        ]
      : [];
  });
}
