-- Harness ("Jod: Harness for Bank"): a chat Agent set up for one bank desk,
-- with Skills, Rules, Pipelines, a Knowledge base, Staff with Roles and an
-- append-only Audit trail. Language: src/features/harness/GLOSSARY.md.
-- Decisions: docs/adr/0013 … 0018.
--
-- Everything lives in one Owner's Workspace (ADR 0011, ADR 0014). Every table
-- carries `owner` and references `harness.workspaces (owner)` with
-- `on delete cascade`, so the Workspace row is the one top-level row: it is the
-- only table registered in `access.owned_tables`, and purging an Owner deletes
-- the Workspace and, by cascade, everything in it.
--
-- Accessed only from server code over a direct Postgres connection
-- (HARNESS_DATABASE_URL, falling back to CLIENT_MANAGER_DATABASE_URL); never
-- from the browser or the Data API.

create extension if not exists vector with schema extensions;

create schema if not exists harness;

-- Workspace and Staff -----------------------------------------------------------

create table harness.workspaces (
  -- `host:<auth user id>`, `guest:<guest pass id>` or `e2e`.
  owner text primary key check (char_length(owner) between 1 and 80),
  -- Null while the first seed is still running; set in the same transaction.
  seeded_at timestamptz,
  -- Which seed the Workspace holds, so a later seed can top it up.
  seed_version integer not null default 0 check (seed_version >= 0),
  created_at timestamptz not null default now()
);

create table harness.staff (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  -- Stable name of a seeded Staff member (`officer-1`), the same in every
  -- Workspace, so a Scenario can say who to switch to. Not shown to anyone.
  key text not null check (key ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  title text not null check (char_length(title) between 1 and 80),
  role text not null check (role in ('user', 'admin')),
  initials text not null check (char_length(initials) between 1 and 3),
  created_at timestamptz not null default now(),
  unique (owner, key)
);

-- Sessions and messages ---------------------------------------------------------

create table harness.sessions (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  -- The Staff member the Session belongs to; they read its Audit trail.
  staff_id uuid not null references harness.staff (id),
  title text not null default 'New session'
    check (char_length(title) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sessions_owner_idx on harness.sessions (owner, updated_at desc);
create index sessions_staff_idx on harness.sessions (staff_id, updated_at desc);

create table harness.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references harness.sessions (id) on delete cascade,
  owner text not null references harness.workspaces (owner) on delete cascade,
  role text not null check (role in ('staff', 'agent')),
  -- Who wrote a `staff` message; null for the Agent.
  staff_id uuid references harness.staff (id),
  content text not null default '',
  -- Tool calls, attachments, Run cards, Source cards, Conflict cards.
  parts jsonb not null default '[]'::jsonb,
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  created_at timestamptz not null default clock_timestamp(),
  check ((role = 'staff') = (staff_id is not null))
);

create index messages_session_idx on harness.messages (session_id, created_at, id);
-- Messages per hour, for the limit.
create index messages_owner_idx on harness.messages (owner, created_at desc);

-- Skills and Rules: Versions ----------------------------------------------------

-- No rows for a Skill means its Default applies (domain/skills/defaults.ts).
create table harness.skill_versions (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  skill_id text not null check (skill_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(skill_id) <= 64),
  version integer not null check (version >= 1),
  name text not null check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(name) <= 64),
  description text not null check (char_length(description) between 1 and 1024),
  body text not null check (char_length(body) <= 60000),
  saved_by uuid not null references harness.staff (id),
  -- Why it was saved; "Restored the Default" for a restore.
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (owner, skill_id, version)
);

-- No rows for a Rule means its defaults apply (domain/rules/defaults.ts).
create table harness.rule_versions (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  rule_id text not null check (char_length(rule_id) between 1 and 80),
  version integer not null check (version >= 1),
  enabled boolean not null default true,
  -- The Rule's Parameters, validated against its RuleSpec before saving.
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  outcome text not null check (outcome in ('block', 'refer', 'warn')),
  effective_from date not null,
  saved_by uuid not null references harness.staff (id),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (owner, rule_id, version)
);

-- Knowledge base: Sources, Passages, Conflicts ----------------------------------

create table harness.sources (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null check (kind in ('pdf', 'sheet', 'csv', 'doc', 'text', 'web')),
  -- Key in the private `harness` bucket; null for seed text and web pages.
  storage_path text,
  bytes bigint not null default 0 check (bytes >= 0),
  -- Shipped with the Workspace; cannot be removed.
  is_seed boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'reading', 'ready', 'failed')),
  error text,
  added_by uuid references harness.staff (id),
  -- The Session it was uploaded in, if any.
  session_id uuid references harness.sessions (id) on delete set null,
  -- The date the document itself carries; decides which of two Passages is newer.
  document_date date,
  created_at timestamptz not null default now()
);

create index sources_owner_idx on harness.sources (owner, created_at desc);
create index sources_session_idx on harness.sources (session_id) where session_id is not null;

create table harness.passages (
  id bigint generated always as identity primary key,
  source_id uuid not null references harness.sources (id) on delete cascade,
  owner text not null references harness.workspaces (owner) on delete cascade,
  -- Order within the Source.
  ordinal integer not null check (ordinal >= 0),
  heading text,
  body text not null check (char_length(body) between 1 and 8000),
  embedding extensions.vector(768),
  search tsvector generated always as (
    to_tsvector('english', coalesce(heading, '') || ' ' || body)
  ) stored,
  -- Set by a Resolution: kept, marked, and left out of search (ADR 0016).
  superseded_by bigint references harness.passages (id) on delete set null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_id, ordinal),
  check (superseded_by is null or superseded_by <> id)
);

create index passages_owner_idx on harness.passages (owner, source_id);
create index passages_search_idx on harness.passages using gin (search);
create index passages_embedding_idx on harness.passages
  using hnsw (embedding extensions.vector_cosine_ops);
create index passages_superseded_by_idx on harness.passages (superseded_by)
  where superseded_by is not null;

create table harness.conflicts (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  new_passage_id bigint not null references harness.passages (id) on delete cascade,
  old_passage_id bigint not null references harness.passages (id) on delete cascade,
  -- What the two Passages disagree about, in one or two sentences.
  summary text not null,
  -- What the Agent proposes; a person decides.
  proposal text not null check (proposal in ('supersede', 'keep_both', 'set_aside')),
  reasoning text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('supersede', 'keep_both', 'set_aside')),
  decided_by uuid references harness.staff (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (new_passage_id <> old_passage_id),
  check ((status = 'resolved') = (resolution is not null)),
  unique (new_passage_id, old_passage_id)
);

create index conflicts_owner_idx on harness.conflicts (owner, status, created_at desc);
create index conflicts_old_passage_idx on harness.conflicts (old_passage_id);

-- Hybrid search: nearest Passages by embedding, fused with full-text matches
-- (reciprocal rank fusion), so a form number or a section is found as well as
-- a paraphrase. Superseded Passages and Sources still being read are left out.
create function harness.search_passages(
  p_owner text,
  p_query text,
  p_embedding extensions.vector(768),
  p_limit integer default 8
)
returns table (
  passage_id bigint,
  source_id uuid,
  source_title text,
  source_kind text,
  document_date date,
  ordinal integer,
  heading text,
  body text,
  score double precision,
  semantic double precision,
  lexical real,
  conflict_open boolean
)
language sql
stable
set search_path = extensions, public
as $$
  with terms as (
    select nullif(
      array_to_string(array(
        -- Quoted for tsquery by hand: quote_literal would write E'..' for a
        -- lexeme with a backslash, and tsquery would read the E as a word.
        select '''' || replace(replace(lexeme, '\', '\\'), '''', '''''') || ''':*'
        from unnest(to_tsvector('english', p_query))
      ), ' | '),
      ''
    ) as tsq
  ),
  live as (
    select p.id, p.embedding, p.search
    from harness.passages p
    join harness.sources s on s.id = p.source_id
    where p.owner = p_owner and s.owner = p_owner
      and s.status = 'ready'
      and p.superseded_by is null
  ),
  semantic as (
    select l.id, 1 - (l.embedding <=> p_embedding) as similarity,
           row_number() over (order by l.embedding <=> p_embedding) as rank
    from live l
    where l.embedding is not null and p_embedding is not null
    order by l.embedding <=> p_embedding
    limit 30
  ),
  lexical as (
    select l.id, ts_rank_cd(l.search, to_tsquery('english', t.tsq)) as rank_score,
           row_number() over (order by ts_rank_cd(l.search, to_tsquery('english', t.tsq)) desc) as rank
    from live l, terms t
    where t.tsq is not null
      and l.search @@ to_tsquery('english', t.tsq)
    order by rank_score desc
    limit 30
  ),
  fused as (
    select coalesce(s.id, l.id) as id,
           coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + l.rank), 0) as score,
           s.similarity as semantic,
           l.rank_score as lexical
    from semantic s
    full join lexical l on l.id = s.id
    order by score desc, id
    limit greatest(1, least(p_limit, 25))
  )
  select p.id, p.source_id, src.title, src.kind, src.document_date,
         p.ordinal, p.heading, p.body,
         f.score::double precision, f.semantic, f.lexical,
         exists (
           select 1 from harness.conflicts c
           where c.status = 'open'
             and (c.new_passage_id = p.id or c.old_passage_id = p.id)
         )
  from fused f
  join harness.passages p on p.id = f.id
  join harness.sources src on src.id = p.source_id
  order by f.score desc, p.id;
$$;

-- Records: Employers, Members, Schedules, Remittances ---------------------------

create table harness.employers (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 160),
  status text not null default 'active'
    check (status in ('active', 'delinquent', 'suspended', 'closed')),
  joined_on date,
  contact_email text,
  unique (owner, code)
);

create table harness.members (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  employer_id uuid references harness.employers (id) on delete set null,
  member_no text not null check (char_length(member_no) between 1 and 20),
  full_name text not null check (char_length(full_name) between 1 and 160),
  date_of_birth date,
  nationality text,
  caymanian boolean not null default false,
  residency_status text,
  left_cayman_on date,
  employment_ended_on date,
  last_contribution_on date,
  balance_kyd numeric(14, 2) not null default 0 check (balance_kyd >= 0),
  vested boolean not null default true,
  email text,
  address text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'deferred', 'retired', 'deceased', 'closed')),
  unique (owner, member_no)
);

create index members_employer_idx on harness.members (employer_id);
create index members_name_idx on harness.members (owner, lower(full_name));

create table harness.schedules (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  employer_id uuid not null references harness.employers (id) on delete cascade,
  -- The contribution month, as its first day.
  period date not null check (extract(day from period) = 1),
  -- The uploaded file the Schedule was read from, if it came by upload.
  source_id uuid references harness.sources (id) on delete set null,
  received_on date,
  status text not null default 'received'
    check (status in ('received', 'processing', 'reconciled', 'queried', 'rejected')),
  unique (owner, employer_id, period)
);

create index schedules_employer_idx on harness.schedules (employer_id, period desc);

create table harness.schedule_lines (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references harness.schedules (id) on delete cascade,
  owner text not null references harness.workspaces (owner) on delete cascade,
  member_no text not null,
  member_name text not null,
  earnings_kyd numeric(14, 2) not null check (earnings_kyd >= 0),
  employee_kyd numeric(14, 2) not null check (employee_kyd >= 0),
  employer_kyd numeric(14, 2) not null check (employer_kyd >= 0),
  voluntary_kyd numeric(14, 2) not null default 0 check (voluntary_kyd >= 0)
);

create index schedule_lines_schedule_idx on harness.schedule_lines (schedule_id);
create index schedule_lines_member_idx on harness.schedule_lines (owner, member_no);

create table harness.remittances (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  employer_id uuid not null references harness.employers (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  amount_kyd numeric(14, 2) not null check (amount_kyd >= 0),
  received_on date not null,
  reference text
);

create index remittances_employer_idx on harness.remittances (employer_id, period desc);

-- Runs: Steps, Findings, Approvals ----------------------------------------------

create table harness.runs (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  -- Null when started from Claude over MCP, or after its Session is gone.
  session_id uuid references harness.sessions (id) on delete set null,
  pipeline_id text not null
    check (pipeline_id in ('member_request', 'contribution_processing', 'delinquency_report')),
  -- The Vercel Workflow run that carries it.
  workflow_run_id text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_approval', 'completed', 'returned', 'failed', 'stopped')),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  -- rule_id → the Version this Run applied (ADR 0015).
  rule_versions jsonb not null default '{}'::jsonb check (jsonb_typeof(rule_versions) = 'object'),
  started_by uuid not null references harness.staff (id),
  started_via text not null check (started_via in ('chat', 'mcp', 'app', 'demo')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index runs_owner_idx on harness.runs (owner, created_at desc);
create index runs_session_idx on harness.runs (session_id, created_at desc)
  where session_id is not null;
-- Runs at work, for the concurrency cap.
create index runs_active_idx on harness.runs (owner)
  where status in ('queued', 'running', 'waiting_approval');

create table harness.run_steps (
  run_id uuid not null references harness.runs (id) on delete cascade,
  step_id text not null,
  owner text not null references harness.workspaces (owner) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  started_at timestamptz,
  finished_at timestamptz,
  output jsonb,
  error text,
  -- Set only for Steps that call a model.
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  primary key (run_id, step_id)
);

create table harness.findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references harness.runs (id) on delete cascade,
  owner text not null references harness.workspaces (owner) on delete cascade,
  rule_id text not null,
  rule_version integer not null check (rule_version >= 0),
  step_id text not null,
  met boolean not null,
  -- The Rule's Outcome at that Version; it bites only when `met` is false.
  outcome text not null check (outcome in ('block', 'refer', 'warn')),
  summary text not null,
  -- The values the check compared, shown with the Finding.
  compared jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, rule_id)
);

create index findings_run_idx on harness.findings (run_id, created_at);

create table harness.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references harness.runs (id) on delete cascade,
  owner text not null references harness.workspaces (owner) on delete cascade,
  -- What is being approved: `letter`, `payment_instruction`, `regulator_report`, …
  kind text not null,
  risk text not null check (risk in ('low', 'high')),
  title text not null,
  -- The Draft put to the person.
  draft jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'returned', 'expired')),
  -- The Workflow hook that resumes the Run when a person decides.
  hook_token text,
  requested_at timestamptz not null default now(),
  decided_by uuid references harness.staff (id),
  decided_at timestamptz,
  note text check (char_length(note) <= 1000),
  check ((status in ('approved', 'returned')) = (decided_by is not null))
);

create index approvals_run_idx on harness.approvals (run_id, requested_at);
create index approvals_pending_idx on harness.approvals (owner, requested_at desc)
  where status = 'pending';

create table harness.member_requests (
  id uuid primary key default gen_random_uuid(),
  owner text not null references harness.workspaces (owner) on delete cascade,
  member_id uuid not null references harness.members (id) on delete cascade,
  kind text not null
    check (kind in ('transfer_out', 'cessation_of_residence', 'property', 'retirement', 'death')),
  received_on date not null,
  status text not null default 'received'
    check (status in ('received', 'in_review', 'approved', 'returned', 'paid', 'closed')),
  amount_kyd numeric(14, 2) check (amount_kyd >= 0),
  details jsonb not null default '{}'::jsonb,
  -- The latest Run that handled it.
  run_id uuid references harness.runs (id) on delete set null
);

create index member_requests_owner_idx on harness.member_requests (owner, received_on desc);
create index member_requests_member_idx on harness.member_requests (member_id);

-- Sandbox -------------------------------------------------------------------------

-- One container per Session, on the VPS, driven by the Runner (ADR 0017).
create table harness.sandboxes (
  session_id uuid primary key references harness.sessions (id) on delete cascade,
  owner text not null references harness.workspaces (owner) on delete cascade,
  container text not null,
  status text not null default 'starting'
    check (status in ('starting', 'ready', 'stopped')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index sandboxes_owner_idx on harness.sandboxes (owner);

-- Rate limits ------------------------------------------------------------------

-- One row per unit of capped work a visitor did (a message, a Run, a Source,
-- a Sandbox command), counted per hour against LIMITS in
-- src/features/harness/domain/limits.ts. Limits stay on the visitor hash, not
-- the Owner (AGENTS.md); the Owner is here only so the rows go with the
-- Workspace.
create table harness.rate_hits (
  id bigint generated always as identity primary key,
  owner text not null references harness.workspaces (owner) on delete cascade,
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  kind text not null check (kind in ('message', 'run', 'source', 'search', 'sandbox_command')),
  created_at timestamptz not null default now()
);

create index rate_hits_visitor_idx on harness.rate_hits (visitor_hash, kind, created_at desc);
create index rate_hits_owner_idx on harness.rate_hits (owner);

-- Audit trail (ADR 0018) --------------------------------------------------------

create table harness.audit_events (
  id bigint generated always as identity primary key,
  owner text not null references harness.workspaces (owner) on delete cascade,
  -- Plain ids, no foreign keys: an event outlives the Session and the Run it
  -- names, and goes only with the Workspace.
  session_id uuid,
  run_id uuid,
  actor_kind text not null check (actor_kind in ('staff', 'agent', 'system')),
  staff_id uuid,
  -- The actor's name as it was then: a Staff member's name, "Agent", "System".
  actor_label text not null,
  -- From the fixed list in src/features/harness/domain/audit.ts.
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_kind text,
  target_id text,
  summary text not null,
  -- Ids, names, sizes, Rule Versions; never a secret or a whole document.
  detail jsonb not null default '{}'::jsonb,
  -- Agent events carry what the call cost.
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  created_at timestamptz not null default clock_timestamp(),
  check ((actor_kind = 'staff') = (staff_id is not null))
);

create index audit_events_owner_idx on harness.audit_events (owner, created_at desc);
create index audit_events_session_idx on harness.audit_events (owner, session_id, id);

-- Events are only ever added. UPDATE and TRUNCATE are always refused. DELETE
-- is refused while the event's Workspace exists, and that is the whole
-- mechanism that lets the Owner purge through:
--
--   `access.purge_owner` runs `delete from harness.workspaces where owner = $1`
--   (the only Harness table in `access.owned_tables`). The foreign key on
--   `owner` cascades that delete to the events. By the time the cascade
--   reaches a row here the Workspace row is already gone, so the trigger lets
--   the row go. Any other DELETE finds the Workspace still there and fails.
--
-- This was chosen over a transaction-local setting checked by the trigger
-- because it needs no change to `access.purge_owner` (it knows nothing about
-- the Harness), cannot be switched on by a caller who merely knows the
-- setting's name, and does not depend on the order in which the purge walks
-- the registry. Do NOT register `harness.audit_events` (or any other Harness
-- table) in `access.owned_tables`: a direct `delete … where owner = $1` on
-- this table would raise and abort the whole purge.
create function harness.audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from harness.workspaces w where w.owner = old.owner
    ) then
      return old;
    end if;
    raise exception 'harness.audit_events is append-only: an Audit event goes only with its Workspace'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'harness.audit_events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger audit_events_no_update
  before update on harness.audit_events
  for each row execute function harness.audit_events_append_only();

create trigger audit_events_no_delete
  before delete on harness.audit_events
  for each row execute function harness.audit_events_append_only();

create trigger audit_events_no_truncate
  before truncate on harness.audit_events
  for each statement execute function harness.audit_events_append_only();

-- Access: server only -----------------------------------------------------------

alter table harness.workspaces enable row level security;
alter table harness.staff enable row level security;
alter table harness.sessions enable row level security;
alter table harness.messages enable row level security;
alter table harness.skill_versions enable row level security;
alter table harness.rule_versions enable row level security;
alter table harness.sources enable row level security;
alter table harness.passages enable row level security;
alter table harness.conflicts enable row level security;
alter table harness.employers enable row level security;
alter table harness.members enable row level security;
alter table harness.schedules enable row level security;
alter table harness.schedule_lines enable row level security;
alter table harness.remittances enable row level security;
alter table harness.runs enable row level security;
alter table harness.run_steps enable row level security;
alter table harness.findings enable row level security;
alter table harness.approvals enable row level security;
alter table harness.member_requests enable row level security;
alter table harness.sandboxes enable row level security;
alter table harness.rate_hits enable row level security;
alter table harness.audit_events enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema harness from anon, authenticated';
    execute 'revoke all on all tables in schema harness from anon, authenticated';
    execute 'revoke execute on all functions in schema harness from public, anon, authenticated';
  end if;
end;
$$;

-- Owner purge (ADR 0011): the Workspace row is the one top-level row; every
-- other table goes with it by cascade. See the note on the Audit trail above.
insert into access.owned_tables (table_name)
values ('harness.workspaces')
on conflict do nothing;

-- Storage: private bucket for uploaded Sources ----------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('harness', 'harness', false, 10485760)
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Retention: rate limit rows are only read for the last hour ---------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'harness-delete-old-rate-hits',
      '49 3 * * *',
      $cron$delete from harness.rate_hits where created_at < now() - interval '1 day'$cron$
    );
  end if;
end;
$$;
