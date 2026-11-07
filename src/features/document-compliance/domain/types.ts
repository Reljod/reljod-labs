export type DocumentKind =
  | "identity_document"
  | "proof_of_address"
  | "certified_copy";

export type SourceFormat = "image" | "pdf_digital" | "pdf_scanned";

export type Outcome = "pass" | "fail" | "needs_review";

/** A box on a page, normalised to 0-1 with a top-left origin. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type Span = {
  ref: string;
  page: number;
  text: string;
  granularity: "word" | "line" | "element";
  box: Box;
  confidence: number | null;
};

/** The model's fix to one OCR'd Span's text; it never changes where the Span is. */
export type SpanCorrection = { ref: string; text: string };

export type ClientDeclaration = {
  fullName: string;
  dateOfBirth: string;
  residentialAddress: string;
};

export const FIELD_NAMES = [
  "full_name",
  "date_of_birth",
  "date_of_issue",
  "date_of_expiry",
  "mrz_date_of_expiry",
  "statement_date",
  "address",
  "certification_wording",
  "certifier_name",
  "certifier_occupation",
  "certification_date",
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

/** A value the model read, before code has checked it against its Spans. */
export type FieldReading = {
  name: FieldName;
  value: string;
  spanRefs: string[];
  confidence: number;
};

export type ExtractedField = FieldReading & { verified: boolean };

/** Questions only the model can answer from the page image. */
export type DocumentJudgments = {
  legible: boolean;
  tamperingSuspected: boolean;
  tamperingSpanRefs: string[];
  signaturePresent: boolean | null;
  notes: string;
};

export type ExtractedDocument = {
  kind: DocumentKind;
  spans: Span[];
  fields: ExtractedField[];
  judgments: DocumentJudgments;
};

export type Evidence = {
  documentKind: DocumentKind;
  fieldName: FieldName | null;
  spanRefs: string[];
};

export type Finding = {
  requirementId: string;
  outcome: Outcome;
  reason: string;
  evidence: Evidence[];
};
