-- Switchboard: the phone line of the fictional Meridia Rail, answered by one
-- voice agent the caller can interrupt. Language:
-- src/features/switchboard/GLOSSARY.md. Decisions: docs/adr/0029, 0030.
--
-- Everything lives in one Owner's Workspace (ADR 0011). Every table carries
-- `owner` and references `switchboard.workspaces (owner)` with
-- `on delete cascade`, so the Workspace row is the one top-level row: it is the
-- only table registered in `access.owned_tables`, and purging an Owner deletes
-- the Workspace and, by cascade, everything in it.
--
-- Accessed only from server code over a direct Postgres connection
-- (SWITCHBOARD_DATABASE_URL, falling back to CLIENT_MANAGER_DATABASE_URL);
-- never from the browser or the Data API. Purely additive: a new schema, new
-- tables, one new private bucket.

create schema if not exists switchboard;

-- Workspace ---------------------------------------------------------------------

create table switchboard.workspaces (
  -- `host:<auth user id>`, `guest:<guest pass id>` or `e2e`.
  owner text primary key check (char_length(owner) between 1 and 80),
  -- Null while the first seed is still running; set in the same transaction.
  seeded_at timestamptz,
  seed_version integer not null default 0 check (seed_version >= 0),
  -- The last number handed out for a Record reference (RF-0007, LP-0003).
  ref_seq integer not null default 0 check (ref_seq >= 0),
  created_at timestamptz not null default now()
);

-- Back office: the railway's Records ----------------------------------------------

-- One table for every kind of Record. The Back office stands in for the
-- railway's own systems, which the demo does not model one by one; each kind's
-- shape is a zod schema in `domain/world.ts`, checked on every write.
create table switchboard.records (
  id uuid primary key default gen_random_uuid(),
  owner text not null references switchboard.workspaces (owner) on delete cascade,
  kind text not null check (kind in (
    'booking', 'disruption', 'compensation', 'lost_property',
    'assistance', 'handoff', 'callback', 'confirmation'
  )),
  -- What a person says on the phone: MR-7K2Q9F, RF-0007.
  ref text not null check (char_length(ref) between 1 and 40),
  data jsonb not null,
  -- The Call that made or last changed it, if a Call did. No foreign key: a
  -- Record outlives nothing but its Workspace.
  call_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, kind, ref)
);

create index records_owner_kind_idx on switchboard.records (owner, kind, updated_at desc);
create index records_call_idx on switchboard.records (call_id) where call_id is not null;

-- Rules (ADR 0015 shape) ------------------------------------------------------------

-- Defaults live in code as version 1 (`domain/rules.ts`); an edit is a row.
create table switchboard.rule_versions (
  id bigint generated always as identity primary key,
  owner text not null references switchboard.workspaces (owner) on delete cascade,
  rule_id text not null check (rule_id ~ '^[a-z][a-z_.]{0,59}$'),
  version integer not null check (version >= 2),
  enabled boolean not null,
  params jsonb not null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (owner, rule_id, version)
);

-- Calls -------------------------------------------------------------------------------

create table switchboard.calls (
  id uuid primary key default gen_random_uuid(),
  owner text not null references switchboard.workspaces (owner) on delete cascade,
  -- voice: a realtime speech-to-speech session in the browser. text: the same
  -- Agent, a turn at a time on the server.
  line text not null check (line in ('voice', 'text')),
  -- Who dialled: the app, or an outside MCP client playing the Caller.
  origin text not null default 'app' check (origin in ('app', 'mcp')),
  status text not null default 'live' check (status in ('live', 'ended', 'cut_off', 'failed')),
  end_reason text check (end_reason is null or char_length(end_reason) <= 200),
  model text not null check (char_length(model) between 1 and 120),
  scenario jsonb not null default '{}'::jsonb,
  -- The Rules as they stood when the Call started: id, version, enabled, params.
  rulebook jsonb not null,
  -- What the harness knows mid-call: identity verified for which Booking,
  -- failed attempts, what was issued so far.
  state jsonb not null default '{}'::jsonb,
  consent_audio boolean not null default false,
  audio_path text check (audio_path is null or char_length(audio_path) <= 300),
  usage jsonb not null default '{}'::jsonb,
  cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0),
  wrapup jsonb,
  wrapup_status text not null default 'none'
    check (wrapup_status in ('none', 'running', 'done', 'failed')),
  workflow_run_id text,
  -- The server's clock decides when the Call is over, whatever the browser does.
  deadline_at timestamptz not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index calls_owner_idx on switchboard.calls (owner, started_at desc);
create index calls_live_idx on switchboard.calls (owner) where status = 'live';

-- Rate limits ---------------------------------------------------------------------

create table switchboard.rate_hits (
  id bigint generated always as identity primary key,
  owner text not null references switchboard.workspaces (owner) on delete cascade,
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  kind text not null check (kind in ('call', 'turn', 'supervisor', 'sandbox')),
  created_at timestamptz not null default now()
);

create index rate_hits_visitor_idx on switchboard.rate_hits (visitor_hash, kind, created_at desc);
create index rate_hits_owner_idx on switchboard.rate_hits (owner);

-- Audit trail (ADR 0018 shape) --------------------------------------------------------

create table switchboard.events (
  id bigint generated always as identity primary key,
  owner text not null references switchboard.workspaces (owner) on delete cascade,
  -- Plain id, no foreign key: an event goes only with the Workspace.
  call_id uuid,
  actor text not null check (actor in ('caller', 'agent', 'system', 'owner', 'client', 'supervisor')),
  type text not null check (type ~ '^[a-z][a-z_.]{0,59}$'),
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index events_owner_idx on switchboard.events (owner, id desc);
create index events_call_idx on switchboard.events (call_id, id) where call_id is not null;

-- Append-only, the way harness.audit_events is: UPDATE and TRUNCATE are always
-- refused; DELETE is refused unless the Workspace row is already gone, which
-- is only true inside the cascade of the Owner purge. Do NOT register this (or
-- any other Switchboard table but workspaces) in `access.owned_tables`.
create function switchboard.events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from switchboard.workspaces w where w.owner = old.owner
    ) then
      return old;
    end if;
    raise exception 'switchboard.events is append-only: an event goes only with its Workspace'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'switchboard.events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger events_no_update
  before update on switchboard.events
  for each row execute function switchboard.events_append_only();

create trigger events_no_delete
  before delete on switchboard.events
  for each row execute function switchboard.events_append_only();

create trigger events_no_truncate
  before truncate on switchboard.events
  for each statement execute function switchboard.events_append_only();

-- Access: server only ---------------------------------------------------------------

alter table switchboard.workspaces enable row level security;
alter table switchboard.records enable row level security;
alter table switchboard.rule_versions enable row level security;
alter table switchboard.calls enable row level security;
alter table switchboard.rate_hits enable row level security;
alter table switchboard.events enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema switchboard from anon, authenticated';
    execute 'revoke all on all tables in schema switchboard from anon, authenticated';
    execute 'revoke execute on all functions in schema switchboard from public, anon, authenticated';
  end if;
end;
$$;

-- The Owner purge (ADR 0011) deletes the Workspace; everything else cascades.
insert into access.owned_tables (table_name)
values ('switchboard.workspaces')
on conflict do nothing;

-- Call recordings, kept only when the visitor ticked consent. Private: read
-- and written through signed URLs made by the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'switchboard', 'switchboard', false, 26214400,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']
)
on conflict (id) do nothing;
