-- Loupe: a forensic examiner for documents. One Examiner looks at a Document,
-- tests what it suspects with code in a Sandbox, and Rules in code decide the
-- Verdict from what was measured. Language: src/features/loupe/GLOSSARY.md.
-- Decisions: docs/adr/0027-loupe-findings-are-measured-by-code.md,
-- docs/adr/0028-loupe-examiner-tools-are-the-mcp-server.md.
--
-- Purely additive: a new schema, new tables and a new private bucket.
--
-- Everything belongs to one Owner (ADR 0011). `loupe.owners` is the one
-- top-level row and the only table registered in `access.owned_tables`;
-- every other table references it with `on delete cascade`, so purging an
-- Owner deletes the row and, by cascade, everything they saved.
--
-- Accessed only from server code over a direct Postgres connection
-- (LOUPE_DATABASE_URL, falling back to CLIENT_MANAGER_DATABASE_URL); never
-- from the browser or the Data API.

create schema if not exists loupe;

create table loupe.owners (
  -- `host:<auth user id>`, `guest:<guest pass id>` or `e2e`.
  owner text primary key check (char_length(owner) between 1 and 80),
  created_at timestamptz not null default now()
);

-- Rulebooks: versioned per Owner -------------------------------------------------

-- Every edit writes a new version; version 0 is the built-in Defaults in code
-- (DEFAULT_RULEBOOK) and is never stored.
create table loupe.rulebooks (
  id bigint generated always as identity primary key,
  owner text not null references loupe.owners (owner) on delete cascade,
  version integer not null check (version > 0),
  rulebook jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  -- What changed against the version before it, one line each.
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner, version)
);

-- Uploads: the Owner's own Documents, in the private bucket ---------------------------

create table loupe.uploads (
  id uuid primary key default gen_random_uuid(),
  owner text not null references loupe.owners (owner) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (
    kind in ('payslip', 'bank_statement', 'utility_bill', 'invoice', 'id_card', 'other')
  ),
  format text not null check (format in ('pdf', 'image')),
  content_type text not null check (
    content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  bytes bigint not null check (bytes between 1 and 12582912),
  -- `u/<owner key>/<id>.<ext>`, built on the server, never from browser input.
  storage_path text not null unique,
  -- A Forgery's ground truth: { sampleId, edits: Edit[] }. Null for a plain Upload.
  forgery jsonb,
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index uploads_owner_created_at_idx on loupe.uploads (owner, created_at desc);

-- Examinations --------------------------------------------------------------------

create table loupe.examinations (
  id uuid primary key default gen_random_uuid(),
  owner text not null references loupe.owners (owner) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (
    kind in ('payslip', 'bank_statement', 'utility_bill', 'invoice', 'id_card', 'other')
  ),
  format text not null check (format in ('pdf', 'image')),
  -- { kind: 'sample', sampleId } or { kind: 'upload', uploadId }.
  source jsonb not null,
  is_forgery boolean not null default false,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'failed', 'stopped')
  ),
  model text not null,
  -- False for a Sweep-only Examination: no Examiner, no model call.
  examiner boolean not null default true,
  -- The Rulebook the current Verdict was decided under. A Re-evaluate
  -- replaces both, and says so on the Trail.
  rulebook_version integer not null check (rulebook_version >= 0),
  rulebook jsonb not null,
  workflow_run_id text,
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- PageInfo[] with asset keys (or static Sample URLs) as `image`.
  pages jsonb not null default '[]'::jsonb,
  -- The Examination's working state, changed only by its tools under a row
  -- lock: { measurements, hypotheses, reviews, looked, counters, skills }.
  state jsonb not null default '{}'::jsonb,
  -- Finding[] and VerdictResult as decided under `rulebook`.
  findings jsonb not null default '[]'::jsonb,
  verdict jsonb,
  score jsonb,
  gate jsonb,
  stopped_by text check (stopped_by is null or stopped_by in ('turns', 'cost', 'idle')),
  error text,
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  -- Who started it: the Owner in the app, or a client on the Owner's MCP token.
  via text not null default 'app' check (via in ('app', 'mcp')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index examinations_owner_started_at_idx
  on loupe.examinations (owner, started_at desc);
create index examinations_visitor_hash_started_at_idx
  on loupe.examinations (visitor_hash, started_at);

-- The Trail: append-only events of an Examination ------------------------------------

create table loupe.examination_events (
  -- Global and increasing: an Examination's events in order, and the cursor a
  -- stream resumes from.
  seq bigint generated always as identity primary key,
  examination_id uuid not null references loupe.examinations (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  type text not null check (type ~ '^[a-z]+$'),
  -- The TrailEvent without `at` and `type` (domain/contract.ts).
  payload jsonb not null default '{}'::jsonb
);

create index examination_events_examination_id_seq_idx
  on loupe.examination_events (examination_id, seq);

-- Events are only ever added. UPDATE and TRUNCATE are always refused. DELETE
-- is refused while the event's Examination exists, so the only way an event
-- goes is with its Examination: the Owner purge deletes `loupe.owners`, the
-- foreign keys cascade down here, and by then the Examination row is gone.
create function loupe.examination_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from loupe.examinations e where e.id = old.examination_id
    ) then
      return old;
    end if;
    raise exception 'loupe.examination_events is append-only: an event goes only with its Examination'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'loupe.examination_events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger examination_events_no_update
  before update on loupe.examination_events
  for each row execute function loupe.examination_events_append_only();

create trigger examination_events_no_delete
  before delete on loupe.examination_events
  for each row execute function loupe.examination_events_append_only();

create trigger examination_events_no_truncate
  before truncate on loupe.examination_events
  for each statement execute function loupe.examination_events_append_only();

-- Spend: every model call, priced by the gateway --------------------------------------

create table loupe.model_calls (
  id bigint generated always as identity primary key,
  examination_id uuid not null references loupe.examinations (id) on delete cascade,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index model_calls_examination_id_idx on loupe.model_calls (examination_id);

-- The Audit trail: the Owner's writes outside an Examination's own Trail --------------

create table loupe.audit_events (
  id bigint generated always as identity primary key,
  owner text not null references loupe.owners (owner) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  action text not null check (
    action in (
      'examination.started', 'examination.stopped', 'examination.reevaluated',
      'check.run', 'rulebook.saved', 'upload.created', 'forgery.created',
      'token.minted'
    )
  ),
  via text not null check (via in ('app', 'mcp')),
  -- Ids, names and sizes; never a file or a token.
  detail jsonb not null default '{}'::jsonb
);

create index audit_events_owner_id_idx on loupe.audit_events (owner, id desc);

create function loupe.audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from loupe.owners o where o.owner = old.owner) then
      return old;
    end if;
    raise exception 'loupe.audit_events is append-only: an Audit event goes only with its Owner'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'loupe.audit_events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger audit_events_no_update
  before update on loupe.audit_events
  for each row execute function loupe.audit_events_append_only();

create trigger audit_events_no_delete
  before delete on loupe.audit_events
  for each row execute function loupe.audit_events_append_only();

create trigger audit_events_no_truncate
  before truncate on loupe.audit_events
  for each statement execute function loupe.audit_events_append_only();

-- Hourly caps on work outside an Examination's own caps ---------------------------------

create table loupe.rate_events (
  id bigint generated always as identity primary key,
  owner text not null references loupe.owners (owner) on delete cascade,
  visitor_hash text not null,
  kind text not null check (kind in ('check', 'reevaluate', 'token')),
  at timestamptz not null default now()
);

create index rate_events_visitor_kind_at_idx
  on loupe.rate_events (visitor_hash, kind, at);
create index rate_events_owner_kind_at_idx
  on loupe.rate_events (owner, kind, at);

-- The Sandbox snapshot that holds the Toolkit's Python packages -----------------------

-- Not an Owner's data: one row per requirements hash, shared by everyone.
-- Built on first use (server/snapshot.ts) and reused until its hash changes.
create table loupe.toolkit_snapshots (
  requirements_hash text primary key check (char_length(requirements_hash) between 8 and 80),
  snapshot_id text not null,
  created_at timestamptz not null default now()
);

-- Row level security: no policies, so only the service role and the direct
-- connection (which owns the tables) reach them ----------------------------------------

alter table loupe.owners enable row level security;
alter table loupe.rulebooks enable row level security;
alter table loupe.uploads enable row level security;
alter table loupe.examinations enable row level security;
alter table loupe.examination_events enable row level security;
alter table loupe.model_calls enable row level security;
alter table loupe.audit_events enable row level security;
alter table loupe.rate_events enable row level security;
alter table loupe.toolkit_snapshots enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema loupe from public, anon, authenticated';
    execute 'revoke all on all tables in schema loupe from public, anon, authenticated';
    execute 'revoke execute on all functions in schema loupe from public, anon, authenticated';
  end if;
end;
$$;

-- Owners (ADR 0011): the purge deletes the Owner row; everything cascades ----------------

insert into access.owned_tables values ('loupe.owners')
on conflict do nothing;

-- Storage: private bucket for Uploads, page images and Evidence layers ------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('loupe', 'loupe', false, 12582912)
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Retention: rate rows are only read for the last day ------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'loupe-rate-events-cleanup',
      '17 * * * *',
      $job$delete from loupe.rate_events where at < now() - interval '2 days'$job$
    );
  end if;
end;
$$;
