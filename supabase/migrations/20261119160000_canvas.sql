-- Canvas: an Analyst that answers a Question about data with Views (ADR 0031,
-- ADR 0032). Words are in src/features/canvas/GLOSSARY.md.
--
-- Everything an Owner saves hangs off `canvas.workspaces` (one row per Owner)
-- by `on delete cascade`. That table is the only one registered in
-- `access.owned_tables`: purging an Owner deletes the Workspace and, by
-- cascade, their Conversations, Views, Boards, Uploads, Rulebooks and Trail.
--
-- Reached only from server code over a direct Postgres connection
-- (CANVAS_DATABASE_URL, falling back to CLIENT_MANAGER_DATABASE_URL); never
-- from the browser or the Data API. Purely additive: a new schema, new tables
-- and a new bucket.

create schema if not exists canvas;

create table canvas.workspaces (
  -- `host:<auth user id>`, `guest:<guest pass id>` or `e2e`.
  owner text primary key check (char_length(owner) between 1 and 80),
  created_at timestamptz not null default now()
);

-- Rules are data (ADR 0015): every save is a new Version of the whole Rulebook.
create table canvas.rulebooks (
  owner text not null references canvas.workspaces (owner) on delete cascade,
  version integer not null check (version >= 1),
  rules jsonb not null,
  -- Which Rules this Version changed, for the history.
  changed text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (owner, version)
);

create table canvas.conversations (
  id uuid primary key default gen_random_uuid(),
  owner text not null references canvas.workspaces (owner) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_owner_idx on canvas.conversations (owner, updated_at desc);

create table canvas.messages (
  id uuid primary key default gen_random_uuid(),
  owner text not null references canvas.workspaces (owner) on delete cascade,
  conversation_id uuid not null references canvas.conversations (id) on delete cascade,
  role text not null check (role in ('person', 'analyst')),
  content text not null,
  -- An Analyst message: the events of its turn, so the page can show it again.
  parts jsonb not null default '[]'::jsonb,
  -- An Analyst message: model, turns, tokens, cost.
  usage jsonb,
  -- A person's message is a Question; its Sandbox time so far, against the cap.
  sandbox_ms integer not null default 0 check (sandbox_ms >= 0),
  created_at timestamptz not null default clock_timestamp()
);

create index messages_conversation_idx on canvas.messages (conversation_id, created_at);
create index messages_owner_idx on canvas.messages (owner);

create table canvas.views (
  id uuid primary key default gen_random_uuid(),
  owner text not null references canvas.workspaces (owner) on delete cascade,
  -- A View outlives its Conversation while a Board holds it.
  conversation_id uuid references canvas.conversations (id) on delete set null,
  -- The View grammar (`canvas.view/1`).
  spec jsonb not null,
  -- The Parameters' current values.
  params jsonb not null default '{}'::jsonb,
  -- The rows on screen: columns, rows, rowCount, truncated, ms.
  result jsonb not null,
  verification jsonb not null,
  findings jsonb not null default '[]'::jsonb,
  status text not null check (status in ('verified', 'flagged')),
  rulebook_version integer not null check (rulebook_version >= 0),
  -- Tables read, Restricted columns aggregated, the Runs behind the rows.
  work jsonb not null,
  -- What the Guard passed, so a Control re-runs it without parsing again.
  guarded jsonb not null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index views_owner_idx on canvas.views (owner, created_at desc);
create index views_conversation_idx on canvas.views (conversation_id, created_at);

create table canvas.boards (
  id uuid primary key default gen_random_uuid(),
  owner text not null references canvas.workspaces (owner) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  -- A Schedule: minutes between Refreshes, how many are left, and the id the
  -- sleeping workflow must still find here to act (conventions.md, "A durable
  -- workflow outlives the row that says it ended").
  schedule_minutes integer check (schedule_minutes >= 1),
  schedule_left integer not null default 0 check (schedule_left >= 0),
  schedule_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index boards_owner_idx on canvas.boards (owner, updated_at desc);

create table canvas.board_items (
  board_id uuid not null references canvas.boards (id) on delete cascade,
  view_id uuid not null references canvas.views (id) on delete cascade,
  owner text not null references canvas.workspaces (owner) on delete cascade,
  position integer not null check (position >= 0),
  -- Columns the View spans on the Board's two-column grid.
  span integer not null default 1 check (span in (1, 2)),
  primary key (board_id, view_id)
);

create index board_items_view_idx on canvas.board_items (view_id);
create index board_items_owner_idx on canvas.board_items (owner);

create table canvas.refreshes (
  id uuid primary key default gen_random_uuid(),
  owner text not null references canvas.workspaces (owner) on delete cascade,
  board_id uuid not null references canvas.boards (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  trigger text not null check (trigger in ('manual', 'schedule')),
  workflow_run_id text,
  -- Per View: what changed (status, Claims, row count) or why it failed.
  report jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index refreshes_board_idx on canvas.refreshes (board_id, created_at desc);
create index refreshes_owner_idx on canvas.refreshes (owner);

create table canvas.uploads (
  id uuid primary key default gen_random_uuid(),
  owner text not null references canvas.workspaces (owner) on delete cascade,
  -- The file's name as shown; never used in a path.
  name text not null check (char_length(name) between 1 and 120),
  -- The Table it becomes in this Owner's Catalog.
  table_name text not null check (table_name ~ '^up_[a-z0-9_]{1,48}$'),
  format text not null check (format in ('csv', 'parquet')),
  bytes bigint not null check (bytes >= 0),
  storage_path text not null,
  status text not null check (status in ('pending', 'ready', 'failed')),
  -- Columns with types and simple statistics, and the row count.
  profile jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (owner, table_name)
);

create index uploads_owner_idx on canvas.uploads (owner, created_at desc);

-- Hourly limits count against the visitor hash (AGENTS.md).
create table canvas.rate_hits (
  id bigint generated always as identity primary key,
  owner text not null references canvas.workspaces (owner) on delete cascade,
  visitor_hash text not null,
  kind text not null check (kind in ('question', 'run', 'refresh', 'upload')),
  created_at timestamptz not null default now()
);

create index rate_hits_visitor_idx on canvas.rate_hits (visitor_hash, kind, created_at desc);
create index rate_hits_owner_idx on canvas.rate_hits (owner);

-- The Sandbox image that holds the Catalog: one per data and runner version,
-- shared by every Owner (it holds only the synthetic Meridia data).
create table canvas.sandbox_images (
  key text primary key check (char_length(key) between 1 and 120),
  snapshot_id text,
  status text not null check (status in ('building', 'ready')),
  claimed_at timestamptz not null default now(),
  built_at timestamptz
);

-- The Trail -----------------------------------------------------------------------

create table canvas.events (
  id bigint generated always as identity primary key,
  owner text not null references canvas.workspaces (owner) on delete cascade,
  -- Plain ids, no foreign keys: an event outlives what it names.
  conversation_id uuid,
  question_id uuid,
  view_id uuid,
  board_id uuid,
  actor_kind text not null check (actor_kind in ('person', 'analyst', 'client', 'system')),
  -- From the fixed list in src/features/canvas/domain/trail.ts.
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  summary text not null,
  -- Ids, names, sizes, the text of a Query or of code; never a secret or a whole result.
  detail jsonb not null default '{}'::jsonb,
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  ms integer check (ms >= 0),
  created_at timestamptz not null default clock_timestamp()
);

create index events_owner_idx on canvas.events (owner, id desc);
create index events_question_idx on canvas.events (owner, question_id, id);
create index events_view_idx on canvas.events (owner, view_id, id);

-- Events are only ever added. UPDATE and TRUNCATE are always refused; DELETE
-- only goes through when the event's Workspace is already gone, which is how
-- the Owner purge cascades (the same mechanism as harness.audit_events, ADR
-- 0018). Do NOT register this table in `access.owned_tables`.
create function canvas.events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from canvas.workspaces w where w.owner = old.owner
    ) then
      return old;
    end if;
    raise exception 'canvas.events is append-only: an event goes only with its Workspace'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'canvas.events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger events_no_update
  before update on canvas.events
  for each row execute function canvas.events_append_only();

create trigger events_no_delete
  before delete on canvas.events
  for each row execute function canvas.events_append_only();

create trigger events_no_truncate
  before truncate on canvas.events
  for each statement execute function canvas.events_append_only();

-- Access: server only -----------------------------------------------------------

alter table canvas.workspaces enable row level security;
alter table canvas.rulebooks enable row level security;
alter table canvas.conversations enable row level security;
alter table canvas.messages enable row level security;
alter table canvas.views enable row level security;
alter table canvas.boards enable row level security;
alter table canvas.board_items enable row level security;
alter table canvas.refreshes enable row level security;
alter table canvas.uploads enable row level security;
alter table canvas.rate_hits enable row level security;
alter table canvas.sandbox_images enable row level security;
alter table canvas.events enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema canvas from anon, authenticated';
    execute 'revoke all on all tables in schema canvas from anon, authenticated';
    execute 'revoke execute on all functions in schema canvas from public, anon, authenticated';
  end if;
end;
$$;

-- The Owner purge reaches everything through the Workspace.
insert into access.owned_tables (table_name)
values ('canvas.workspaces')
on conflict do nothing;

-- Uploads: a private bucket, written through signed upload URLs.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('canvas', 'canvas', false, 20971520)
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Retention: rate limit rows are only read for the last hour.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'canvas-delete-old-rate-hits',
      '53 3 * * *',
      $cron$delete from canvas.rate_hits where created_at < now() - interval '1 day'$cron$
    );
  end if;
end;
$$;
