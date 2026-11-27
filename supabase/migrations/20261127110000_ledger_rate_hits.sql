-- Ledger: take a rate hit before the model is called.
--
-- Was: the rate limit counted rows of `ledger.builds`, which are stored only
-- after the model finishes. A client that hung up mid-stream, or posted many
-- Builds at once, was never counted. Now every Build takes a hit here first,
-- under an advisory lock, so the count and the insert stand or fall together.
--
-- Additive: the code already deployed never reads this table. The new code
-- calls `ledger.take_rate_hit`, so apply this before it deploys.
-- Rate limits stay on the visitor hash: no `owner`, not an owned table.

create table ledger.rate_hits (
  id bigint generated always as identity primary key,
  -- Salted hash of the visitor's IP.
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index rate_hits_visitor_hash_created_at_idx
  on ledger.rate_hits (visitor_hash, created_at desc);
create index rate_hits_created_at_idx on ledger.rate_hits (created_at);

alter table ledger.rate_hits enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.
revoke all on ledger.rate_hits from anon, authenticated;
grant all on ledger.rate_hits to service_role;

-- Returns null when a Build may run (and, with p_take, records its hit), or
-- which cap it ran into: 'visitor' (this hour) or 'site' (the last day).
-- One lock for the whole site, because the daily cap is shared: two requests
-- at once cannot both take the last place.
create function ledger.take_rate_hit(
  p_visitor_hash text,
  p_per_hour integer,
  p_per_day integer,
  p_take boolean default true
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  visitor_used integer;
  site_used integer;
begin
  if p_take then
    perform pg_advisory_xact_lock(hashtextextended('ledger:rate_hits', 0));
  end if;

  select count(*) into visitor_used
  from ledger.rate_hits rh
  where rh.visitor_hash = p_visitor_hash
    and rh.created_at > now() - interval '1 hour';
  if visitor_used >= p_per_hour then
    return 'visitor';
  end if;

  select count(*) into site_used
  from ledger.rate_hits rh
  where rh.created_at > now() - interval '1 day';
  if site_used >= p_per_day then
    return 'site';
  end if;

  if p_take then
    insert into ledger.rate_hits (visitor_hash) values (p_visitor_hash);
  end if;
  return null;
end;
$$;

revoke all on function ledger.take_rate_hit(text, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function ledger.take_rate_hit(text, integer, integer, boolean)
  to service_role;

-- Retention: hits are only read for the last day --------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'ledger-delete-old-rate-hits',
      '27 3 * * *',
      $cron$delete from ledger.rate_hits where created_at < now() - interval '2 days'$cron$
    );
  end if;
end;
$$;
