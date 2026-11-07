-- Document compliance checks: Pre-screen runs and their audit trail
-- (run -> documents -> spans -> extracted fields -> findings -> evidence).
-- Accessed only from server code with the service role; never from the browser.

create schema if not exists document_compliance;

-- Pre-screen runs ------------------------------------------------------------

create table document_compliance.prescreen_runs (
  id uuid primary key default gen_random_uuid(),
  pack_slug text not null,
  rulebook_id text not null,
  rulebook_version text not null,
  client_declaration jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'parsing', 'extracting', 'evaluating', 'completed', 'failed')),
  model text,
  error text,
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days'
);

-- Rate limiting: runs per visitor in the last hour, and runs today.
create index prescreen_runs_visitor_hash_created_at_idx
  on document_compliance.prescreen_runs (visitor_hash, created_at);
create index prescreen_runs_created_at_idx
  on document_compliance.prescreen_runs (created_at);
-- Fallback: latest completed run for a pack.
create index prescreen_runs_pack_slug_completed_idx
  on document_compliance.prescreen_runs (pack_slug, completed_at desc)
  where status = 'completed';
create index prescreen_runs_expires_at_idx
  on document_compliance.prescreen_runs (expires_at);

-- Documents ------------------------------------------------------------------

create table document_compliance.documents (
  id bigint generated always as identity primary key,
  run_id uuid not null references document_compliance.prescreen_runs (id) on delete cascade,
  kind text not null
    check (kind in ('identity_document', 'proof_of_address', 'certified_copy')),
  storage_path text not null,
  media_type text not null,
  source_format text not null
    check (source_format in ('image', 'pdf_digital', 'pdf_scanned')),
  parser text not null
    check (parser in ('paddleocr', 'opendataloader_pdf')),
  page_count integer not null check (page_count > 0)
);

create index documents_run_id_idx on document_compliance.documents (run_id);

-- Spans: text plus its box, normalised to 0-1 with a top-left origin ----------

create table document_compliance.spans (
  id bigint generated always as identity primary key,
  document_id bigint not null references document_compliance.documents (id) on delete cascade,
  -- Stable ID the model answers with, unique within a document (e.g. "p1-s12").
  ref text not null,
  page integer not null check (page > 0),
  text text not null,
  granularity text not null check (granularity in ('word', 'line', 'element')),
  x0 real not null check (x0 between 0 and 1),
  y0 real not null check (y0 between 0 and 1),
  x1 real not null check (x1 between 0 and 1),
  y1 real not null check (y1 between 0 and 1),
  -- Null when the parser reports none (opendataloader-pdf).
  confidence real check (confidence between 0 and 1),
  unique (document_id, ref),
  check (x0 <= x1 and y0 <= y1)
);

-- Extracted fields -----------------------------------------------------------

create table document_compliance.extracted_fields (
  id bigint generated always as identity primary key,
  document_id bigint not null references document_compliance.documents (id) on delete cascade,
  name text not null,
  value text not null,
  normalized_value text,
  confidence real check (confidence between 0 and 1),
  -- True when code confirmed the value appears in its spans' text.
  verified boolean not null,
  unique (document_id, name)
);

create table document_compliance.extracted_field_spans (
  extracted_field_id bigint not null references document_compliance.extracted_fields (id) on delete cascade,
  span_id bigint not null references document_compliance.spans (id) on delete cascade,
  primary key (extracted_field_id, span_id)
);

create index extracted_field_spans_span_id_idx
  on document_compliance.extracted_field_spans (span_id);

-- Findings and their evidence --------------------------------------------------

create table document_compliance.findings (
  id bigint generated always as identity primary key,
  run_id uuid not null references document_compliance.prescreen_runs (id) on delete cascade,
  requirement_id text not null,
  outcome text not null check (outcome in ('pass', 'fail', 'needs_review')),
  reason text not null,
  unique (run_id, requirement_id)
);

-- A finding cites an extracted field, a span (e.g. suspected tampering),
-- or a whole document (e.g. a missing certification).
create table document_compliance.finding_evidence (
  id bigint generated always as identity primary key,
  finding_id bigint not null references document_compliance.findings (id) on delete cascade,
  document_id bigint not null references document_compliance.documents (id) on delete cascade,
  extracted_field_id bigint references document_compliance.extracted_fields (id) on delete cascade,
  span_id bigint references document_compliance.spans (id) on delete cascade
);

create index finding_evidence_finding_id_idx on document_compliance.finding_evidence (finding_id);
create index finding_evidence_document_id_idx on document_compliance.finding_evidence (document_id);
create index finding_evidence_extracted_field_id_idx on document_compliance.finding_evidence (extracted_field_id);
create index finding_evidence_span_id_idx on document_compliance.finding_evidence (span_id);

-- Access: service role only ----------------------------------------------------

alter table document_compliance.prescreen_runs enable row level security;
alter table document_compliance.documents enable row level security;
alter table document_compliance.spans enable row level security;
alter table document_compliance.extracted_fields enable row level security;
alter table document_compliance.extracted_field_spans enable row level security;
alter table document_compliance.findings enable row level security;
alter table document_compliance.finding_evidence enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.

revoke all on schema document_compliance from anon, authenticated;
grant usage on schema document_compliance to service_role;
grant all on all tables in schema document_compliance to service_role;
grant all on all sequences in schema document_compliance to service_role;
alter default privileges in schema document_compliance
  grant all on tables to service_role;
alter default privileges in schema document_compliance
  grant all on sequences to service_role;

-- Storage: private bucket for the preset packs' files -------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-compliance',
  'document-compliance',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do nothing;

-- Retention: delete expired runs daily (children cascade) ---------------------

create extension if not exists pg_cron;

select cron.schedule(
  'document-compliance-delete-expired-runs',
  '17 3 * * *',
  $$delete from document_compliance.prescreen_runs where expires_at < now()$$
);
