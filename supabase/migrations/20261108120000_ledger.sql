-- Ledger: Ask sessions and their Builds (one per question).
-- Accessed only from server code with the service role; never from the browser.
-- The `ledger` schema must be listed under Data API > Exposed schemas.

create schema if not exists ledger;

create table ledger.ask_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

create index ask_sessions_expires_at_idx on ledger.ask_sessions (expires_at);

create table ledger.builds (
  id uuid primary key default gen_random_uuid(),
  ask_session_id uuid not null references ledger.ask_sessions (id) on delete cascade,
  position integer not null,
  question text not null check (char_length(question) between 1 and 300),
  -- The validated Build plan: source paths and verbatim excerpts, never positions.
  build_plan jsonb not null,
  model text not null,
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  unique (ask_session_id, position)
);

-- Rate limiting: Builds per visitor in the last hour, and Builds today.
create index builds_visitor_hash_created_at_idx
  on ledger.builds (visitor_hash, created_at);
create index builds_created_at_idx on ledger.builds (created_at);

-- Access: service role only ----------------------------------------------------

alter table ledger.ask_sessions enable row level security;
alter table ledger.builds enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.

revoke all on schema ledger from anon, authenticated;
grant usage on schema ledger to service_role;
grant all on all tables in schema ledger to service_role;
alter default privileges in schema ledger grant all on tables to service_role;

-- Retention: delete expired Ask sessions daily (Builds cascade) ----------------

create extension if not exists pg_cron;

select cron.schedule(
  'ledger-delete-expired-ask-sessions',
  '23 3 * * *',
  $$delete from ledger.ask_sessions where expires_at < now()$$
);
