import type { FieldCheck } from "./domain/field-checks";
import type { RequirementId, Rulebook } from "./domain/rulebook";
import type {
  Box,
  DocumentKind,
  FieldName,
  Finding,
  Outcome,
} from "./domain/types";

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
  parser: string;
  pageCount: number;
  pages: { page: number; imageUrl: string }[];
  spans: { ref: string; page: number; text: string; box: Box }[];
  fields: {
    name: FieldName;
    value: string;
    verified: boolean;
    confidence: number | null;
    spanRefs: string[];
  }[];
  checks: FieldCheck[];
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
