-- Run metrics and Sessions (ADR 0007).
-- Each Document keeps what reading it cost: the model that answered, its token
-- usage and price, how long each stage took and the model's raw answer. Runs
-- started from one browser share a Session id so a visitor can return to them.

alter table document_compliance.prescreen_runs
  -- Random id from an httpOnly cookie; groups a browser's runs, nothing else.
  add column session_id text;

create index prescreen_runs_session_id_created_at_idx
  on document_compliance.prescreen_runs (session_id, created_at desc)
  where session_id is not null;

alter table document_compliance.documents
  -- The model id the gateway resolved, and the provider that served it.
  add column model text,
  add column provider text,
  add column input_tokens integer check (input_tokens >= 0),
  add column output_tokens integer check (output_tokens >= 0),
  add column reasoning_tokens integer check (reasoning_tokens >= 0),
  add column cached_input_tokens integer check (cached_input_tokens >= 0),
  -- What the gateway charged for the read, in US dollars; null when not reported.
  add column cost_usd numeric(12, 6) check (cost_usd >= 0),
  add column parse_ms integer check (parse_ms >= 0),
  add column read_ms integer check (read_ms >= 0),
  -- The model's structured answer exactly as returned: corrections, fields, judgments.
  add column raw_output jsonb;
