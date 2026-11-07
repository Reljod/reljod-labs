import type { DocumentKind, FieldName, Outcome } from "../domain/types";

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
