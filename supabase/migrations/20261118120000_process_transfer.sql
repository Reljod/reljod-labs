-- Process transfer: a Recording of a handover call becomes a Process, a
-- workflow document and an approved slide Deck. The app reaches this schema
-- directly with a privileged Postgres connection (like Client Manager), not
-- through the Data API, so nothing here needs exposing.
--
-- Everything a person saves belongs to an Owner (ADR 0011): runs, settings
-- and the Audit trail. Additive only.

create schema if not exists process_transfer;

-- Runs ------------------------------------------------------------------------

-- One Recording through the pipeline. The jsonb columns are the parts of
-- `RunView` (src/features/process-transfer/domain/run.ts); every patch the
-- workflow streams is written here too, so a finished Run reopens without
-- its stream.
create table process_transfer.runs (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  visitor_hash text not null,
  source_kind text not null check (source_kind in ('sample', 'upload')),
  sample_slug text,
  -- Key in the private `process-transfer` bucket, under the Owner's prefix.
  recording_path text,
  recording_name text,
  recording_type text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'stopped')),
  title text not null default '',
  workflow_run_id text,
  stages jsonb not null default '[]'::jsonb,
  watch jsonb,
  process jsonb,
  process_checks jsonb not null default '[]'::jsonb,
  process_findings jsonb not null default '[]'::jsonb,
  rounds jsonb not null default '[]'::jsonb,
  approval jsonb,
  -- The grounding Check (a second model against the Recording) as Verify
  -- computed it. Written once; a Redo reuses it under its own Rules.
  grounding jsonb,
  -- The resolved Rules, their version and the models the Run used.
  rules jsonb not null default '[]'::jsonb,
  rules_version integer not null default 0,
  models jsonb not null default '{}'::jsonb,
  logs jsonb not null default '[]'::jsonb,
  cost_usd numeric(12, 6) not null default 0,
  -- Redos so far; also the generation of the pipeline allowed to write.
  redos integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  -- When the current pass started: the Run itself, or its latest Redo.
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (source_kind = 'sample' and sample_slug is not null)
    or (source_kind = 'upload' and recording_path is not null)
  )
);

create index runs_owner_idx on process_transfer.runs (owner, created_at desc);
-- One Run going per Owner at a time. The server checks first and this
-- settles the race between two starts.
create unique index runs_one_active_idx on process_transfer.runs (owner)
  where status in ('queued', 'running');

-- One call to a model, with what it cost. Goes with its Run.
create table process_transfer.model_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references process_transfer.runs (id) on delete cascade,
  purpose text not null check (purpose in ('watch', 'write', 'review')),
  label text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ms integer not null default 0,
  -- Which pass of the pipeline made it: 0 for the Run, n for its nth Redo.
  generation integer not null default 0,
  created_at timestamptz not null default now()
);

create index model_calls_run_idx on process_transfer.model_calls (run_id, created_at);

-- Settings --------------------------------------------------------------------

-- An Owner's Rule overrides and model choice. `version` goes up on every
-- change, and each Run records the version it used.
create table process_transfer.settings (
  owner text primary key,
  rule_overrides jsonb not null default '{}'::jsonb,
  models jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Audit trail -----------------------------------------------------------------

-- Append-only. No foreign key to runs: the trail outlives a Run. Rows leave
-- only when their Owner is purged (`access.purge_owner` deletes by owner).
create table process_transfer.audit_events (
  id bigint generated always as identity primary key,
  owner text not null,
  actor text not null check (actor in ('person', 'pipeline')),
  action text not null,
  run_id uuid,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  -- Who started paid work, for the hourly rate limit. Never shown.
  visitor_hash text,
  created_at timestamptz not null default now()
);

create index audit_events_owner_idx on process_transfer.audit_events (owner, id desc);
create index audit_events_run_idx on process_transfer.audit_events (owner, run_id, id desc)
  where run_id is not null;
create index audit_events_work_idx on process_transfer.audit_events (created_at desc, action)
  where action in ('run.started', 'deck.redone');

-- An audit line is written once. Updates are refused; deletes stay possible
-- so purging an Owner still reaches the trail.
create function process_transfer.refuse_audit_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'process_transfer.audit_events is append-only';
end;
$$;

create trigger audit_events_append_only
  before update on process_transfer.audit_events
  for each row execute function process_transfer.refuse_audit_update();

create trigger audit_events_no_truncate
  before truncate on process_transfer.audit_events
  for each statement execute function process_transfer.refuse_audit_update();

-- Owners ----------------------------------------------------------------------

-- Model calls go with their Run by cascade.
insert into access.owned_tables (table_name)
values
  ('process_transfer.runs'),
  ('process_transfer.settings'),
  ('process_transfer.audit_events')
on conflict do nothing;

-- Access: server only -----------------------------------------------------------

alter table process_transfer.runs enable row level security;
alter table process_transfer.model_calls enable row level security;
alter table process_transfer.settings enable row level security;
alter table process_transfer.audit_events enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema process_transfer from anon, authenticated';
    execute 'revoke execute on all functions in schema process_transfer from public, anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema process_transfer to service_role';
    execute 'grant all on all tables in schema process_transfer to service_role';
    execute 'grant all on all sequences in schema process_transfer to service_role';
  end if;
end;
$$;

-- Storage: private bucket for uploaded Recordings --------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'process-transfer',
      'process-transfer',
      false,
      18874368,
      array['video/mp4', 'video/quicktime']
    )
    on conflict (id) do nothing;
  end if;
end;
$$;
