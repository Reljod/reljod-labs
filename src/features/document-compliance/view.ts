import type { FieldCheck } from "./domain/field-checks";
import type { RequirementId, Rulebook } from "./domain/rulebook";
import type {
  Box,
  DocumentJudgments,
  DocumentKind,
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
  findings: FindingView[];
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
  | { status: "limited"; runId: string | null; message: string };

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
