-- Name Extraction (shown to visitors as "Sieve"): one Analyst lists every
-- party a long AML Document names. Language: src/features/name-extraction/GLOSSARY.md.
-- Decision: docs/adr/0021-one-analyst-with-tools-not-a-pipeline.md.
--
-- Accessed only from server code with the service role; never from the
-- browser. The `name_extraction` schema must be listed under
-- Data API > Exposed schemas.
--
-- Owners (ADR 0011): `rulebooks`, `uploads` and `runs` hold an Owner's
-- top-level rows and are registered in `access.owned_tables`. A Run's events
-- and model calls go with it by cascade.

create schema if not exists name_extraction;

-- Rulebooks: versioned per Owner -------------------------------------------------

-- Every edit writes a new version; version 0 is the built-in default in code
-- (DEFAULT_RULEBOOK) and is never stored.
create table name_extraction.rulebooks (
  id bigint generated always as identity primary key,
  owner text not null check (char_length(owner) between 1 and 80),
  version integer not null check (version > 0),
  rulebook jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (owner, version)
);

-- Uploads: a Document's pages as JSON in the private bucket -----------------------

create table name_extraction.uploads (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (char_length(owner) between 1 and 80),
  title text not null check (char_length(title) between 1 and 200),
  pages integer not null check (pages between 1 and 500),
  -- `uploads/<owner key>/<id>.json`, built on the server, never from browser input.
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index uploads_owner_created_at_idx
  on name_extraction.uploads (owner, created_at desc);

-- Runs ----------------------------------------------------------------------------

create table name_extraction.runs (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (char_length(owner) between 1 and 80),
  title text not null,
  pages integer not null check (pages between 1 and 500),
  -- { kind: 'corpus', corpusId } or { kind: 'upload', uploadId }.
  source jsonb not null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'failed', 'stopped')
  ),
  -- { analyst, reader }: the models the Run used.
  models jsonb not null,
  rulebook_version integer not null check (rulebook_version >= 0),
  -- The Rulebook as it was when the Run started, for the audit.
  rulebook jsonb not null,
  workflow_run_id text,
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- The Register when the Run ended (ExtractedName[]).
  names jsonb not null default '[]'::jsonb,
  score jsonb,
  error text,
  -- Whether the Done gate had passed when the Run ended; null for a Run
  -- ended outside the workflow (a stop, a failed start, a lost workflow).
  gate_passed boolean,
  -- Why the harness wound a "completed" Run up early, if it did.
  stopped_by text check (stopped_by is null or stopped_by in ('turns', 'cost', 'idle')),
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index runs_owner_started_at_idx
  on name_extraction.runs (owner, started_at desc);
create index runs_visitor_hash_started_at_idx
  on name_extraction.runs (visitor_hash, started_at);
create index runs_started_at_idx on name_extraction.runs (started_at);

-- The Audit trail: append-only events of a Run -------------------------------------

create table name_extraction.run_events (
  -- Global and increasing: a Run's events in order, and the cursor a stream
  -- resumes from.
  seq bigint generated always as identity primary key,
  run_id uuid not null references name_extraction.runs (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  type text not null check (type ~ '^[a-z]+$'),
  -- The RunEvent without `at` and `type` (domain/contract.ts).
  payload jsonb not null default '{}'::jsonb
);

create index run_events_run_id_seq_idx on name_extraction.run_events (run_id, seq);

-- Events are only ever added. UPDATE and TRUNCATE are always refused. DELETE
-- is refused while the event's Run exists, so the only way an event goes is
-- with its Run: the Owner purge (`access.purge_owner` deletes the Run, the
-- foreign key cascades here, and by then the Run row is gone). Do not
-- register this table in `access.owned_tables`: it has no `owner` column and
-- goes with its Run.
create function name_extraction.run_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from name_extraction.runs r where r.id = old.run_id
    ) then
      return old;
    end if;
    raise exception 'name_extraction.run_events is append-only: an event goes only with its Run'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'name_extraction.run_events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger run_events_no_update
  before update on name_extraction.run_events
  for each row execute function name_extraction.run_events_append_only();

create trigger run_events_no_delete
  before delete on name_extraction.run_events
  for each row execute function name_extraction.run_events_append_only();

create trigger run_events_no_truncate
  before truncate on name_extraction.run_events
  for each statement execute function name_extraction.run_events_append_only();

-- Spend: every model call, priced by the gateway ------------------------------------

create table name_extraction.model_calls (
  id bigint generated always as identity primary key,
  run_id uuid not null references name_extraction.runs (id) on delete cascade,
  purpose text not null check (purpose in ('analyst', 'reader')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index model_calls_run_id_idx on name_extraction.model_calls (run_id);

-- Starting a Run under the limits ---------------------------------------------------

-- Counts and inserts under an advisory lock on the Owner and one on the
-- visitor, so two requests at once cannot both take the last place. Returns
-- the new Run's id, or why it was refused. The limits are passed in from
-- LIMITS in server/runs.ts; a trusted visitor (the e2e suite) passes nulls.
create function name_extraction.create_run(
  p_owner text,
  p_visitor_hash text,
  p_title text,
  p_pages integer,
  p_source jsonb,
  p_models jsonb,
  p_rulebook_version integer,
  p_rulebook jsonb,
  p_per_owner_per_day integer,
  p_per_visitor_per_hour integer,
  p_active_per_owner integer
)
returns table (run_id uuid, refusal text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  used integer;
  created uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('name_extraction:owner:' || p_owner, 0));
  perform pg_advisory_xact_lock(hashtextextended('name_extraction:visitor:' || p_visitor_hash, 0));

  if p_active_per_owner is not null then
    select count(*) into used
    from name_extraction.runs r
    where r.owner = p_owner
      and r.status in ('queued', 'running')
      and r.started_at > now() - interval '45 minutes';
    if used >= p_active_per_owner then
      return query select null::uuid, format(
        'You already have %s run%s going. Stop one or let it finish first.',
        used, case when used = 1 then '' else 's' end
      );
      return;
    end if;
  end if;

  if p_per_owner_per_day is not null then
    select count(*) into used
    from name_extraction.runs r
    where r.owner = p_owner and r.started_at > now() - interval '1 day';
    if used >= p_per_owner_per_day then
      return query select null::uuid, format(
        'That''s %s runs today, the demo''s daily limit. Try again tomorrow.', used
      );
      return;
    end if;
  end if;

  if p_per_visitor_per_hour is not null then
    select count(*) into used
    from name_extraction.runs r
    where r.visitor_hash = p_visitor_hash and r.started_at > now() - interval '1 hour';
    if used >= p_per_visitor_per_hour then
      return query select null::uuid, format(
        'That''s %s runs this hour. Give Sieve a breather and try again later.', used
      );
      return;
    end if;
  end if;

  insert into name_extraction.runs (
    owner, visitor_hash, title, pages, source, models, rulebook_version, rulebook
  ) values (
    p_owner, p_visitor_hash, p_title, p_pages, p_source, p_models,
    p_rulebook_version, p_rulebook
  )
  returning id into created;

  return query select created, null::text;
end;
$$;

-- Saving a Rulebook writes the next version for the Owner, under a daily cap
-- per Owner (LIMITS.rulebooksPerOwnerPerDay in server/runs.ts; a trusted
-- visitor passes null). Returns the new version, or why it was refused.
create function name_extraction.save_rulebook(
  p_owner text,
  p_rulebook jsonb,
  p_note text,
  p_per_owner_per_day integer
)
returns table (version integer, refusal text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  used integer;
  next_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('name_extraction:rulebook:' || p_owner, 0));
  if p_per_owner_per_day is not null then
    select count(*) into used
    from name_extraction.rulebooks rb
    where rb.owner = p_owner and rb.created_at > now() - interval '1 day';
    if used >= p_per_owner_per_day then
      return query select null::integer, format(
        'That''s %s Rulebook saves today, the demo''s daily limit. Try again tomorrow.', used
      );
      return;
    end if;
  end if;
  select coalesce(max(rb.version), 0) + 1 into next_version
  from name_extraction.rulebooks rb
  where rb.owner = p_owner;
  insert into name_extraction.rulebooks (owner, version, rulebook, note)
  values (p_owner, next_version, p_rulebook, p_note);
  return query select next_version, null::text;
end;
$$;

-- Access: service role only ----------------------------------------------------------

alter table name_extraction.rulebooks enable row level security;
alter table name_extraction.uploads enable row level security;
alter table name_extraction.runs enable row level security;
alter table name_extraction.run_events enable row level security;
alter table name_extraction.model_calls enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.

revoke all on schema name_extraction from anon, authenticated;
revoke all on all tables in schema name_extraction from anon, authenticated;
revoke execute on all functions in schema name_extraction from public, anon, authenticated;
grant usage on schema name_extraction to service_role;
grant all on all tables in schema name_extraction to service_role;
grant all on all sequences in schema name_extraction to service_role;
grant execute on function name_extraction.create_run(text, text, text, integer, jsonb, jsonb, integer, jsonb, integer, integer, integer) to service_role;
grant execute on function name_extraction.save_rulebook(text, jsonb, text, integer) to service_role;
alter default privileges in schema name_extraction grant all on tables to service_role;
alter default privileges in schema name_extraction grant all on sequences to service_role;

-- The trail stays append-only for the service role too: the trigger refuses
-- UPDATE, TRUNCATE and a DELETE that is not a cascade from the Run.
revoke update, truncate on name_extraction.run_events from service_role;

-- Storage: private bucket for Uploads ---------------------------------------------------

-- `{ pages: string[] }`, at most 500 pages of 20k characters (checked on load).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('name-extraction', 'name-extraction', false, 26214400, array['application/json'])
on conflict (id) do nothing;

-- Owners (ADR 0011) -----------------------------------------------------------------------

-- Purging an Owner deletes their Rulebooks, Uploads and Runs; a Run's events
-- and model calls go with it by cascade. The Upload's file in Storage is not
-- reached by the purge (as with Casework uploads).
insert into access.owned_tables (table_name)
values
  ('name_extraction.rulebooks'::regclass),
  ('name_extraction.uploads'::regclass),
  ('name_extraction.runs'::regclass)
on conflict do nothing;
