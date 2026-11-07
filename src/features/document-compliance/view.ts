import type { RequirementId } from "./domain/rulebook";
import type { Box, DocumentKind, FieldName, Outcome } from "./domain/types";

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
  prescreenDate: string;
  documents: DocumentView[];
  findings: FindingView[];
};

export type DocumentView = {
  kind: DocumentKind;
  pages: { page: number; imageUrl: string }[];
  spans: { ref: string; page: number; text: string; box: Box }[];
  fields: {
    name: FieldName;
    value: string;
    verified: boolean;
    confidence: number | null;
    spanRefs: string[];
  }[];
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
  | { status: "completed"; runId: string }
  | { status: "failed"; runId: string; message: string }
  | { status: "limited"; runId: string | null; message: string };
