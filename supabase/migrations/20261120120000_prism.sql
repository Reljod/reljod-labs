-- Prism: single-forward-pass Decision Models (`/demos/prism`).
-- Words are in src/features/prism/GLOSSARY.md.
--
-- Reached only from server code over a direct Postgres connection
-- (PRISM_DATABASE_URL, falling back to CLIENT_MANAGER_DATABASE_URL); never
-- from the browser or the Data API. Purely additive: a new schema and one
-- server-only rate-limit table.

create schema if not exists prism;

create table prism.rate_hits (
  id bigint generated always as identity primary key,
  -- `host:<auth user id>`, `guest:<guest pass id>` or `e2e`.
  owner text not null check (char_length(owner) between 1 and 80),
  visitor_hash text not null check (char_length(visitor_hash) between 1 and 128),
  kind text not null check (kind in ('refract', 'tribunal', 'cascade')),
  -- Number of Decision Model calls consumed by this request (1 for refract,
  -- juror count for tribunal, item count for cascade).
  units integer not null default 1 check (units between 1 and 32),
  created_at timestamptz not null default now()
);

create index rate_hits_visitor_idx on prism.rate_hits (visitor_hash, kind, created_at desc);
create index rate_hits_owner_idx on prism.rate_hits (owner);

-- Access: server only -----------------------------------------------------------

alter table prism.rate_hits enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema prism from anon, authenticated';
    execute 'revoke all on all tables in schema prism from anon, authenticated';
  end if;
end;
$$;

-- Register so the 30-day Guest pass purge clears any rows for deleted Owners.
insert into access.owned_tables (table_name)
values ('prism.rate_hits')
on conflict do nothing;

-- Retention: rate limit rows are only read for the last hour.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'prism-delete-old-rate-hits',
      '17 4 * * *',
      $cron$delete from prism.rate_hits where created_at < now() - interval '1 day'$cron$
    );
  end if;
end;
$$;
