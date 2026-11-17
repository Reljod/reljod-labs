/**
 * The papers a Member request can carry. A Step that reads a Source names
 * each paper it finds by one of these; the documents Rules list them as
 * Parameters. No runtime imports, so scripts can load it with Node alone.
 */
export const DOCUMENT_TYPES = [
  "request_letter",
  "transfer_form",
  "international_questionnaire",
  "receiving_plan_document",
  "photo_id",
  "property_form",
  "caymanian_status",
  "lender_letter",
  "non_home_owner_declaration",
  "land_register",
  "retirement_application",
  "death_certificate",
  "claimant_id",
  "proof_of_relationship",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  request_letter: "Request letter",
  transfer_form: "Individual Transfer Request form",
  international_questionnaire: "International Transfer Questionnaire",
  receiving_plan_document: "Receiving plan document",
  photo_id: "Government photo ID",
  property_form: "Property withdrawal application (Schedule form)",
  caymanian_status: "Evidence of Caymanian status",
  lender_letter: "Lender's approval-in-principle letter",
  non_home_owner_declaration: "Declaration of non-current home owner",
  land_register: "Land register extract",
  retirement_application: "Retirement application",
  death_certificate: "Death certificate",
  claimant_id: "Claimant's photo ID",
  proof_of_relationship: "Proof of relationship to the Member",
  other: "Other paper",
};

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" &&
    (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/** The options a documents Rule's list Parameter offers. */
export const DOCUMENT_OPTIONS = DOCUMENT_TYPES.filter(
  (type) => type !== "other" && type !== "request_letter",
).map((type) => ({ value: type, label: DOCUMENT_TYPE_LABEL[type] }));
