-- Helio: shared Postgres rate-limit ledger across all Vercel Function instances.
-- No Owner data is stored here: only a salted visitor hash, bucket, unit count
-- and timestamp, pruned daily by pg_cron.

create schema if not exists helio;

create table if not exists helio.rate_hits (
  id bigint generated always as identity primary key,
  visitor_hash text not null check (char_length(visitor_hash) between 1 and 128),
  bucket text not null check (bucket in ('image', 'director')),
  units int not null check (units between 1 and 10),
  created_at timestamptz not null default now()
);

create index if not exists rate_hits_visitor_bucket_idx
  on helio.rate_hits (visitor_hash, bucket, created_at desc);

create index if not exists rate_hits_bucket_created_idx
  on helio.rate_hits (bucket, created_at desc);

-- Access: server only. No policies: anon and authenticated see nothing.
alter table helio.rate_hits enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema helio from anon, authenticated';
    execute 'revoke all on all tables in schema helio from anon, authenticated';
    execute 'revoke execute on all functions in schema helio from public, anon, authenticated';
  end if;
end;
$$;

-- Retention: keep 2 days so the 24-hour global window is never cut short.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'helio-delete-old-rate-hits',
      '17 4 * * *',
      $cron$delete from helio.rate_hits where created_at < now() - interval '2 days'$cron$
    );
  end if;
end;
$$;
