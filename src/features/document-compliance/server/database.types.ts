/**
 * Types for the `document_compliance` schema, written by hand to match
 * `supabase/migrations/20261107120000_document_compliance.sql` (the type
 * generator only covers `public`). Update both together.
 */

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

type RunRow = {
  id: string;
  pack_slug: string;
  rulebook_id: string;
  rulebook_version: string;
  client_declaration: Json;
  status:
    | "queued"
    | "parsing"
    | "extracting"
    | "evaluating"
    | "completed"
    | "failed";
  model: string | null;
  error: string | null;
  workflow_run_id: string | null;
  visitor_hash: string;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
};

type DocumentRow = {
  id: number;
  run_id: string;
  kind: "identity_document" | "proof_of_address" | "certified_copy";
  storage_path: string;
  media_type: string;
  source_format: "image" | "pdf_digital" | "pdf_scanned";
  parser: "paddleocr" | "opendataloader_pdf";
  page_count: number;
};

type SpanRow = {
  id: number;
  document_id: number;
  ref: string;
  page: number;
  text: string;
  granularity: "word" | "line" | "element";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number | null;
};

type ExtractedFieldRow = {
  id: number;
  document_id: number;
  name: string;
  value: string;
  normalized_value: string | null;
  confidence: number | null;
  verified: boolean;
};

type ExtractedFieldSpanRow = { extracted_field_id: number; span_id: number };

type FindingRow = {
  id: number;
  run_id: string;
  requirement_id: string;
  outcome: "pass" | "fail" | "needs_review";
  reason: string;
};

type FindingEvidenceRow = {
  id: number;
  finding_id: number;
  document_id: number;
  extracted_field_id: number | null;
  span_id: number | null;
};

/** Insert shape: generated and nullable columns become optional. */
type WithoutGenerated<Row, Generated extends keyof Row> = {
  [K in keyof Row as K extends Generated
    ? never
    : null extends Row[K]
      ? never
      : K]: Row[K];
} & {
  [K in keyof Row as K extends Generated
    ? K
    : null extends Row[K]
      ? K
      : never]?: Row[K];
};

export type Database = {
  document_compliance: {
    Tables: {
      prescreen_runs: Table<
        RunRow,
        WithoutGenerated<
          RunRow,
          | "id"
          | "status"
          | "model"
          | "error"
          | "workflow_run_id"
          | "created_at"
          | "completed_at"
          | "expires_at"
        >
      >;
      documents: Table<DocumentRow, WithoutGenerated<DocumentRow, "id">>;
      spans: Table<SpanRow, WithoutGenerated<SpanRow, "id">>;
      extracted_fields: Table<
        ExtractedFieldRow,
        WithoutGenerated<ExtractedFieldRow, "id">
      >;
      extracted_field_spans: Table<
        ExtractedFieldSpanRow,
        ExtractedFieldSpanRow
      >;
      findings: Table<FindingRow, WithoutGenerated<FindingRow, "id">>;
      finding_evidence: Table<
        FindingEvidenceRow,
        WithoutGenerated<FindingEvidenceRow, "id">
      >;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
