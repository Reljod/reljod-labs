-- Casework: caps that hold across an Owner's Desks and across the demo, taken
-- in the same transaction as the work they count, under an advisory lock.
--
-- * A chat turn is taken (`take_chat_turn`) before the Specialist's model is
--   called: the visitor's hourly allowance, the demo's daily turns, the
--   Owner's daily spend summed over all their Desks, and the Desk's own cap.
--   Starting a new Desk resets only the Desk's cap, never the Owner's.
-- * A Run is counted and created in one step (`create_run`), so two requests
--   at once cannot both take the last place in the hour or the day, nor both
--   start on a Desk that allows one Run at a time.
--
-- Additive only: a new table and new functions. The code deployed before
-- this reads none of it and keeps working; the code that calls these
-- functions needs this applied first.

-- Chat turns: one row per message the Specialist was asked to answer --------

create table casework.chat_turns (
  id bigint generated always as identity primary key,
  -- Goes with its Desk, and the Desk with its Owner (access.owned_tables).
  session_id uuid not null references casework.sessions (id) on delete cascade,
  owner text,
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index chat_turns_created_at_idx on casework.chat_turns (created_at);
create index chat_turns_visitor_hash_created_at_idx
  on casework.chat_turns (visitor_hash, created_at);
create index chat_turns_session_id_idx on casework.chat_turns (session_id);

alter table casework.chat_turns enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.
revoke all on casework.chat_turns from anon, authenticated;
grant all on casework.chat_turns to service_role;
grant usage, select on sequence casework.chat_turns_id_seq to service_role;

-- Model calls are summed by time for the Owner's daily spend.
create index if not exists model_calls_session_id_created_at_idx
  on casework.model_calls (session_id, created_at);

-- What one Owner's Desks have spent on models since a time ------------------

create function casework.owner_spend_usd(p_owner text, p_since timestamptz)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(c.cost_usd), 0)
  from casework.sessions s
  join casework.model_calls c on c.session_id = s.id
  where s.owner = p_owner and c.created_at > p_since
$$;

-- Takes one chat turn, or says which cap refused it --------------------------

-- The spend caps count model calls already recorded, which land when a
-- model answers: turns running at the same moment can each pass a cap with
-- the last cents left, so an Owner can overshoot by at most the turns they
-- have in flight, each one turn's cost (the visitor's hourly cap bounds how
-- many). The turn counts themselves are exact.
--
-- Returns `taken` and, when not taken, a refusal code the app turns into
-- words: 'visitor', 'day', 'owner_spend' or 'session_spend'. The limits are
-- passed in from LIMITS in server/runs.ts; a trusted visitor (the e2e suite)
-- passes nulls. A null owner (a Desk from before Owners) skips the Owner cap.
create function casework.take_chat_turn(
  p_session_id uuid,
  p_owner text,
  p_visitor_hash text,
  p_per_visitor_per_hour integer,
  p_turns_per_day integer,
  p_owner_spend_per_day numeric,
  p_session_spend numeric
)
returns table (taken boolean, refusal text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  used numeric;
begin
  -- One lock for the demo's chat: the daily turn cap is global.
  perform pg_advisory_xact_lock(hashtextextended('casework:chat', 0));

  if p_per_visitor_per_hour is not null then
    select count(*) into used
    from casework.chat_turns t
    where t.visitor_hash = p_visitor_hash
      and t.created_at > now() - interval '1 hour';
    if used >= p_per_visitor_per_hour then
      return query select false, 'visitor'::text;
      return;
    end if;
  end if;

  if p_turns_per_day is not null then
    select count(*) into used
    from casework.chat_turns t
    where t.created_at > now() - interval '1 day';
    if used >= p_turns_per_day then
      return query select false, 'day'::text;
      return;
    end if;
  end if;

  if p_owner_spend_per_day is not null and p_owner is not null then
    used := casework.owner_spend_usd(p_owner, now() - interval '1 day');
    if used >= p_owner_spend_per_day then
      return query select false, 'owner_spend'::text;
      return;
    end if;
  end if;

  if p_session_spend is not null then
    select coalesce(sum(c.cost_usd), 0) into used
    from casework.model_calls c
    where c.session_id = p_session_id;
    if used >= p_session_spend then
      return query select false, 'session_spend'::text;
      return;
    end if;
  end if;

  insert into casework.chat_turns (session_id, owner, visitor_hash)
  values (p_session_id, p_owner, p_visitor_hash);

  return query select true, null::text;
end;
$$;

-- Counts and creates a Run, or says which cap refused it ---------------------

-- Returns the new Run's id, or a refusal code: 'active' (the Desk already has
-- a Run going), 'visitor' or 'day'. Limits come from LIMITS in
-- server/runs.ts; a trusted visitor passes nulls for the rate limits.
create function casework.create_run(
  p_session_id uuid,
  p_pipeline text,
  p_jobs text[],
  p_document_ids uuid[],
  p_visitor_hash text,
  p_per_visitor_per_hour integer,
  p_per_day integer,
  p_owner text,
  p_owner_spend_per_day numeric,
  p_session_spend numeric
)
returns table (run_id uuid, refusal text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  used integer;
  spent numeric;
  created uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('casework:runs', 0));

  -- One Run going per Desk. A Run older than 45 minutes has lost its
  -- workflow; the app closes those before it gets here.
  if exists (
    select 1 from casework.runs r
    where r.session_id = p_session_id
      and r.status in ('queued', 'running', 'waiting')
      and r.created_at > now() - interval '45 minutes'
  ) then
    return query select null::uuid, 'active'::text;
    return;
  end if;

  if p_per_visitor_per_hour is not null then
    select count(*) into used
    from casework.runs r
    where r.visitor_hash = p_visitor_hash
      and r.created_at > now() - interval '1 hour';
    if used >= p_per_visitor_per_hour then
      return query select null::uuid, 'visitor'::text;
      return;
    end if;
  end if;

  if p_per_day is not null then
    select count(*) into used
    from casework.runs r
    where r.created_at > now() - interval '1 day';
    if used >= p_per_day then
      return query select null::uuid, 'day'::text;
      return;
    end if;
  end if;

  -- The spend caps, under the same lock, so two Runs cannot both start on
  -- the last dollar. Spend lands as model calls finish, so a Run already
  -- going may still take a little past a cap (at most one Run per Desk).
  if p_owner_spend_per_day is not null and p_owner is not null then
    spent := casework.owner_spend_usd(p_owner, now() - interval '1 day');
    if spent >= p_owner_spend_per_day then
      return query select null::uuid, 'owner_spend'::text;
      return;
    end if;
  end if;

  if p_session_spend is not null then
    select coalesce(sum(c.cost_usd), 0) into spent
    from casework.model_calls c
    where c.session_id = p_session_id;
    if spent >= p_session_spend then
      return query select null::uuid, 'session_spend'::text;
      return;
    end if;
  end if;

  insert into casework.runs (session_id, pipeline, jobs, document_ids, visitor_hash)
  values (p_session_id, p_pipeline, p_jobs, p_document_ids, p_visitor_hash)
  returning id into created;

  return query select created, null::text;
end;
$$;

revoke all on function casework.owner_spend_usd(text, timestamptz) from public, anon, authenticated;
revoke all on function casework.take_chat_turn(uuid, text, text, integer, integer, numeric, numeric) from public, anon, authenticated;
revoke all on function casework.create_run(uuid, text, text[], uuid[], text, integer, integer, text, numeric, numeric) from public, anon, authenticated;
grant execute on function casework.owner_spend_usd(text, timestamptz) to service_role;
grant execute on function casework.take_chat_turn(uuid, text, text, integer, integer, numeric, numeric) to service_role;
grant execute on function casework.create_run(uuid, text, text[], uuid[], text, integer, integer, text, numeric, numeric) to service_role;
