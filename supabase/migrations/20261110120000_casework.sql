-- Casework: the Specialist desk. A Cabinet of Documents, chat Sessions, Runs of
-- Jobs and Pipelines, the Questions they raise, and the cost of every model call.
-- Accessed only from server code with the service role; never from the browser.
-- The `casework` schema must be listed under Data API > Exposed schemas.

create schema if not exists casework;

-- Sessions: one visitor's desk ------------------------------------------------

create table casework.sessions (
  id uuid primary key default gen_random_uuid(),
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  -- Per-session model settings by purpose, layered over the defaults.
  model_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create index sessions_expires_at_idx on casework.sessions (expires_at);

-- The Cabinet ------------------------------------------------------------------

-- A folder of synthetic Documents for one matter, with what a review should find.
create table casework.case_files (
  slug text primary key,
  scenario text not null check (
    scenario in ('pension_withdrawal', 'employer_onboarding', 'structure_review', 'screening_review')
  ),
  title text not null,
  summary text not null,
  as_of date not null,
  expected jsonb not null,
  -- Evaluation split, 60:20:20 by document per scenario (fixtures/casework/splits.json).
  split text not null default 'train' check (split in ('train', 'validation', 'test')),
  position integer not null default 0
);

create table casework.documents (
  id uuid primary key default gen_random_uuid(),
  -- Seeded Documents belong to a Case file; uploads belong to a Session.
  case_file_slug text references casework.case_files (slug) on delete cascade,
  session_id uuid references casework.sessions (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  media_type text not null,
  source_format text not null check (source_format in ('pdf_digital', 'pdf_scanned', 'image', 'csv')),
  storage_path text not null,
  page_paths text[] not null default '{}',
  size_bytes integer not null default 0,
  -- Synthetic Documents only: the kind and fields a correct Read returns.
  label_kind text,
  label jsonb,
  created_at timestamptz not null default now(),
  check ((case_file_slug is null) <> (session_id is null))
);

create index documents_case_file_slug_idx on casework.documents (case_file_slug);
create index documents_session_id_idx on casework.documents (session_id);

-- Conversation -----------------------------------------------------------------

create table casework.messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references casework.sessions (id) on delete cascade,
  role text not null check (role in ('user', 'specialist')),
  text text not null,
  document_ids uuid[] not null default '{}',
  run_id uuid,
  -- Tool calls the Specialist made over MCP for this message.
  tool_calls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_session_id_idx on casework.messages (session_id, id);

-- Runs: one Pipeline or one Job, executed as a workflow ------------------------

create table casework.runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references casework.sessions (id) on delete cascade,
  pipeline text,
  jobs text[] not null,
  document_ids uuid[] not null default '{}',
  status text not null default 'queued' check (
    status in ('queued', 'running', 'waiting', 'completed', 'failed')
  ),
  workflow_run_id text,
  -- The Run's working state when it finished: documents read, checks, decision.
  state jsonb,
  recommendation text,
  error text,
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index runs_session_id_idx on casework.runs (session_id, created_at);
create index runs_visitor_hash_created_at_idx on casework.runs (visitor_hash, created_at);
create index runs_created_at_idx on casework.runs (created_at);

create table casework.job_runs (
  id bigint generated always as identity primary key,
  run_id uuid not null references casework.runs (id) on delete cascade,
  job text not null,
  position integer not null,
  status text not null check (status in ('running', 'waiting', 'done', 'skipped', 'failed')),
  summary text,
  output jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, position)
);

-- Questions: the human in the loop ---------------------------------------------

create table casework.questions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references casework.runs (id) on delete cascade,
  job text not null,
  -- The workflow hook token that resumes the Run.
  token text not null unique,
  prompt text not null,
  -- What would satisfy it: document kinds and/or a typed value.
  wants jsonb not null,
  answer jsonb,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index questions_run_id_idx on casework.questions (run_id);

-- Spend: every model call, priced by the gateway --------------------------------

create table casework.model_calls (
  id bigint generated always as identity primary key,
  session_id uuid references casework.sessions (id) on delete cascade,
  run_id uuid references casework.runs (id) on delete cascade,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index model_calls_session_id_idx on casework.model_calls (session_id);
create index model_calls_run_id_idx on casework.model_calls (run_id);
create index model_calls_created_at_idx on casework.model_calls (created_at);

-- Org-wide model settings by purpose, over the defaults in code.
create table casework.model_settings (
  purpose text primary key,
  model text not null,
  reasoning text check (reasoning in ('none', 'minimal', 'low', 'medium', 'high')),
  temperature numeric(3, 2) check (temperature between 0 and 2),
  max_output_tokens integer check (max_output_tokens > 0),
  updated_at timestamptz not null default now()
);

-- Access: service role only ----------------------------------------------------

alter table casework.sessions enable row level security;
alter table casework.case_files enable row level security;
alter table casework.documents enable row level security;
alter table casework.messages enable row level security;
alter table casework.runs enable row level security;
alter table casework.job_runs enable row level security;
alter table casework.questions enable row level security;
alter table casework.model_calls enable row level security;
alter table casework.model_settings enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.

revoke all on schema casework from anon, authenticated;
grant usage on schema casework to service_role;
grant all on all tables in schema casework to service_role;
grant all on all sequences in schema casework to service_role;
alter default privileges in schema casework grant all on tables to service_role;
alter default privileges in schema casework grant all on sequences to service_role;

-- Storage: private bucket for the Cabinet and visitor uploads -------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('casework', 'casework', false, 15728640)
on conflict (id) do nothing;

-- Retention: delete expired Sessions daily (their uploads, Runs and calls cascade) --

create extension if not exists pg_cron;

select cron.schedule(
  'casework-delete-expired-sessions',
  '41 3 * * *',
  $$delete from casework.sessions where expires_at < now()$$
);
