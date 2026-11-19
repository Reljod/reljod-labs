-- Operator: an agent that keys a legacy system (HARBOURMASTER) through a
-- Guard, with Rules as data and a Verdict from code. Words:
-- src/features/operator/GLOSSARY.md. Decisions: docs/adr/0025, 0026.
--
-- Purely additive: a new schema, its tables and a private bucket. The app
-- reaches the schema directly (OPERATOR_DATABASE_URL, falling back to
-- CLIENT_MANAGER_DATABASE_URL), so it is not exposed through the Data API.
--
-- Every row a visitor saves carries `owner` (ADR 0011). Runs, Rulebooks and
-- Manifests are the top-level tables registered in `access.owned_tables`;
-- events and Approvals go with their Run by cascade.

create schema if not exists operator;

-- Rulebook versions: the Rules of what the Operator may do, per Owner. Version
-- 0 is the Default and lives in code (domain/rules.ts), never here.
create table operator.rulebooks (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  version integer not null check (version >= 1),
  rulebook jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (owner, version)
);

-- Manifests a visitor attached: the file is in the private `operator` bucket,
-- its text and parsed rows are kept here once read.
create table operator.manifests (
  id uuid primary key,
  owner text not null,
  name text not null check (char_length(name) <= 200),
  kind text not null check (kind in ('csv', 'pdf')),
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'read', 'failed')),
  body text,
  parsed jsonb,
  created_at timestamptz not null default now()
);

create index manifests_owner_idx on operator.manifests (owner, created_at desc);

-- One attempt at a Task by one Driver.
create table operator.runs (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  -- Who is spending: a salted hash of the IP. Rate limits stay on it.
  visitor_hash text not null,
  driver text not null check (driver in ('operator', 'client', 'hand')),
  -- The sample Task's id; null for an own Task.
  task_id text,
  title text not null,
  brief text not null,
  manifest_id uuid references operator.manifests (id) on delete set null,
  manifest_name text,
  model text,
  -- The Rulebook the Run ran under, snapshotted, so an old Run can be explained.
  rulebook_version integer not null,
  rulebook jsonb not null,
  -- The scripted Operator of the e2e path: no model call.
  stubbed boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'completed', 'failed', 'stopped')),
  stopped_by text
    check (stopped_by is null or stopped_by in ('finish', 'turns', 'actions', 'cost', 'time', 'idle')),
  verdict text
    check (verdict is null or verdict in ('correct', 'incorrect', 'unverified')),
  findings jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  cost_usd numeric(10, 6) not null default 0,
  error text,
  summary text,
  workflow_run_id text,
  -- What the harness presents to its own endpoints inside the Screen sandbox.
  screen_secret text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index runs_owner_idx on operator.runs (owner, started_at desc);
create index runs_visitor_idx on operator.runs (visitor_hash, started_at desc);

-- The Trail: every Turn, Action, Frame, Rule that fired, pause, decision,
-- piece of code and Finding of a Run, ordered by seq. Append-only.
create table operator.run_events (
  seq bigint generated always as identity primary key,
  run_id uuid not null references operator.runs (id) on delete cascade,
  at timestamptz not null default now(),
  type text not null,
  data jsonb not null
);

create index run_events_run_idx on operator.run_events (run_id, seq);

-- A guarded Action the harness stopped, and the person's decision on it.
create table operator.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references operator.runs (id) on delete cascade,
  -- Names exactly one change to one record (domain/guard.ts).
  fingerprint text not null,
  pending jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'refused', 'expired')),
  -- The workflow hook that waits for the decision; null for a client-driven Run.
  hook_token text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index approvals_run_idx on operator.approvals (run_id, created_at);

-- The Trail is append-only: no UPDATE, no TRUNCATE, and a DELETE only as part
-- of its Run going (the Owner purge deletes `operator.runs`, and the foreign
-- key cascades here; by then the Run row is already gone, so the trigger lets
-- the cascade through). Do NOT register `operator.run_events` in
-- `access.owned_tables`: it has no `owner` column and goes with its Run.
create function operator.run_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from operator.runs r where r.id = old.run_id) then
      return old;
    end if;
    raise exception 'operator.run_events is append-only: an event goes only with its Run'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'operator.run_events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger run_events_no_update
  before update on operator.run_events
  for each row execute function operator.run_events_append_only();

create trigger run_events_no_delete
  before delete on operator.run_events
  for each row execute function operator.run_events_append_only();

create trigger run_events_no_truncate
  before truncate on operator.run_events
  for each statement execute function operator.run_events_append_only();

-- Access: server only -----------------------------------------------------------

alter table operator.rulebooks enable row level security;
alter table operator.manifests enable row level security;
alter table operator.runs enable row level security;
alter table operator.run_events enable row level security;
alter table operator.approvals enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema operator from anon, authenticated';
    execute 'revoke all on all tables in schema operator from anon, authenticated';
    execute 'revoke execute on all functions in schema operator from public, anon, authenticated';
  end if;
end;
$$;

-- Owner purge (ADR 0011).
insert into access.owned_tables (table_name)
values ('operator.runs'), ('operator.rulebooks'), ('operator.manifests')
on conflict do nothing;

-- Storage: private bucket for Frames (`frames/<run id>/<n>.png`) and attached
-- Manifests (`manifests/<owner hash>/<id>.<ext>`).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('operator', 'operator', false, 2097152)
    on conflict (id) do nothing;
  end if;
end;
$$;
