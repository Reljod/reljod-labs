import type { FieldCheckOutcome } from "../domain/field-checks";
import type { DocumentKind, FieldName, Outcome } from "../domain/types";

export const DOCUMENT_SHORT_LABELS: Record<DocumentKind, string> = {
  identity_document: "ID",
  proof_of_address: "Address",
  certified_copy: "Certified copy",
};

/** Field check marks: colours for the box on the page and its stamp. */
export const CHECK_STYLES: Record<
  FieldCheckOutcome,
  { label: string; mark: string; box: string; chip: string; text: string }
> = {
  pass: {
    label: "Pass",
    mark: "✓",
    box: "border-ivy bg-ivy/15",
    chip: "bg-ivy text-paper",
    text: "text-ivy",
  },
  fail: {
    label: "Fail",
    mark: "✕",
    box: "border-seal-red bg-seal-red/20",
    chip: "bg-seal-red text-paper",
    text: "text-seal-red",
  },
  needs_review: {
    label: "Needs review",
    mark: "!",
    box: "border-brass bg-brass/25",
    chip: "bg-brass text-ink",
    text: "text-oak",
  },
  read: {
    label: "Read",
    mark: "·",
    box: "border-federal-blue bg-federal-blue/10",
    chip: "bg-morning-haze text-ink",
    text: "text-federal-blue",
  },
};

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  identity_document: "Identity document",
  proof_of_address: "Proof of address",
  certified_copy: "Certified copy",
};

export const FIELD_LABELS: Record<FieldName, string> = {
  full_name: "Full name",
  date_of_birth: "Date of birth",
  date_of_issue: "Date of issue",
  date_of_expiry: "Date of expiry",
  mrz_date_of_expiry: "Expiry (machine-readable zone)",
  statement_date: "Statement date",
  address: "Address",
  certification_wording: "Certification wording",
  certifier_name: "Certifier name",
  certifier_occupation: "Certifier occupation",
  certification_date: "Certification date",
};

export const OUTCOME_STYLES: Record<
  Outcome,
  { label: string; className: string }
> = {
  pass: { label: "Pass", className: "bg-ivy text-paper" },
  fail: { label: "Fail", className: "bg-seal-red text-paper" },
  needs_review: { label: "Needs review", className: "bg-brass text-ink" },
};
