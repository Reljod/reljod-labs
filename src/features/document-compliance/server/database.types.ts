/**
 * Types for the `document_compliance` schema, written by hand to match
 * `supabase/migrations/` for the `document_compliance` schema (the type
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
  /** Legacy: the browser Session before runs belonged to an Owner. */
  session_id: string | null;
  /** The Owner (`host:…`, `guest:…` or `e2e`); null on runs from before Owners. */
  owner: string | null;
  /** Every Rule as the run applied it; null on runs from before Rules were edited. */
  rules_applied: Json | null;
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
  parser: "paddleocr" | "opendataloader_pdf" | "tesseract" | "pdfjs";
  page_count: number;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cached_input_tokens: number | null;
  /** `numeric` arrives from postgres.js as a string; read it with `asNumber`. Written as a number. */
  cost_usd: number | string | null;
  parse_ms: number | null;
  read_ms: number | null;
  raw_output: Json | null;
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

type RuleVersionRow = {
  id: number;
  owner: string;
  rule_id: string;
  version: number;
  enabled: boolean;
  params: Json;
  restored_from: number | null;
  saved_by: string;
  created_at: string;
};

type EvaluationRow = {
  id: number;
  run_id: string;
  number: number;
  rules_applied: Json;
  findings: Json;
  created_by: string;
  created_at: string;
};

type FindingReviewRow = {
  id: number;
  run_id: string;
  evaluation: number;
  requirement_id: string;
  finding_outcome: "pass" | "fail" | "needs_review";
  outcome: "pass" | "fail";
  note: string;
  reviewer: string;
  created_at: string;
};

type AuditTrailRow = { owner: string; created_at: string };

type AuditEventRow = {
  id: number;
  owner: string;
  run_id: string | null;
  actor_kind: "person" | "model" | "system";
  actor_label: string;
  action: string;
  summary: string;
  details: Json;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  /** `numeric` may arrive as a string from PostgREST. */
  cost_usd: number | string | null;
  created_at: string;
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
          | "session_id"
          | "owner"
          | "rules_applied"
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
      rule_versions: Table<
        RuleVersionRow,
        WithoutGenerated<RuleVersionRow, "id" | "created_at">
      >;
      evaluations: Table<
        EvaluationRow,
        WithoutGenerated<EvaluationRow, "id" | "created_at">
      >;
      finding_reviews: Table<
        FindingReviewRow,
        WithoutGenerated<FindingReviewRow, "id" | "created_at">
      >;
      audit_trails: Table<
        AuditTrailRow,
        WithoutGenerated<AuditTrailRow, "created_at">
      >;
      /** Append-only: written through `append_audit_event` and the functions below. */
      audit_events: Table<
        AuditEventRow,
        WithoutGenerated<AuditEventRow, "id" | "created_at">
      >;
    };
    Views: Record<never, never>;
    /**
     * Writes that land with their Audit event in one transaction. Each raises
     * `limit_reached` past its cap, `run_not_found` for another Owner's run
     * and (`record_review`) `stale_evaluation` when a re-evaluation landed first.
     */
    Functions: {
      append_audit_event: {
        Args: {
          p_owner: string;
          p_run_id: string | null;
          p_actor_kind: AuditEventRow["actor_kind"];
          p_actor_label: string;
          p_action: string;
          p_summary: string;
          p_details?: Json;
          p_model?: string | null;
          p_input_tokens?: number | null;
          p_output_tokens?: number | null;
          p_cost_usd?: number | null;
        };
        Returns: number;
      };
      save_rule_version: {
        Args: {
          p_owner: string;
          p_rule_id: string;
          p_enabled: boolean;
          p_params: Json;
          p_restored_from: number | null;
          p_saved_by: string;
          p_summary: string;
          p_details: Json;
          p_max_per_hour: number;
        };
        Returns: number;
      };
      record_evaluation: {
        Args: {
          p_owner: string;
          p_run_id: string;
          p_rules_applied: Json;
          p_findings: Json;
          p_created_by: string;
          p_summary: string;
          p_details: Json;
          p_max: number;
        };
        Returns: number;
      };
      record_review: {
        Args: {
          p_owner: string;
          p_run_id: string;
          p_evaluation: number;
          p_requirement_id: string;
          p_finding_outcome: FindingReviewRow["finding_outcome"];
          p_outcome: FindingReviewRow["outcome"];
          p_note: string;
          p_reviewer: string;
          p_summary: string;
          p_details: Json;
          p_max: number;
        };
        Returns: number;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
