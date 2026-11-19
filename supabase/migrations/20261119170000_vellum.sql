-- Vellum: a model redraws a screenshot as a vector Drawing; code measures it.
-- Vellum keeps no saved data (a Trace lives in the visitor's browser), so the
-- only table is the rate limiter's. It holds no Owner and is not in
-- access.owned_tables; rows older than a day are deleted as new ones come in.

create schema if not exists vellum;

create table if not exists vellum.rate_hits (
  id bigint generated always as identity primary key,
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  kind text not null check (kind in ('pass')),
  created_at timestamptz not null default now()
);

create index if not exists rate_hits_visitor_idx
  on vellum.rate_hits (visitor_hash, kind, created_at desc);
create index if not exists rate_hits_created_idx
  on vellum.rate_hits (created_at);

alter table vellum.rate_hits enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema vellum from anon, authenticated';
    execute 'revoke all on all tables in schema vellum from anon, authenticated';
  end if;
end;
$$;
