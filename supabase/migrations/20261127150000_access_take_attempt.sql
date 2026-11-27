-- Tries at the door, counted and recorded in one step.
--
-- Was: the server counted a visitor's recent wrong tries, then (after the
-- check) inserted the try. Two requests at once could both pass the count, so
-- a burst could exceed `LIMITS.failedAttempts`. Now `access.take_attempt`
-- counts and inserts under an advisory lock, in one transaction, and records
-- the try as failed up front; the server marks it succeeded afterwards.
--
-- It also takes an optional global cap on wrong tries across every visitor,
-- to blunt guessing Guest codes from many addresses. The server passes it for
-- Guest codes only, so a flood of wrong codes never locks the Host out of
-- signing in.
--
-- Additive: the table is unchanged and the code already deployed keeps
-- counting and inserting as before.

create index if not exists attempts_kind_created_at_failed_idx
  on access.attempts (kind, created_at)
  where not succeeded;

-- Returns the new attempt's id, or null when this visitor (or, with
-- p_global_max_failed, everyone together) has been wrong too often in the
-- window. A refused try is not recorded.
create function access.take_attempt(
  p_visitor_hash text,
  p_kind text,
  p_window_minutes integer,
  p_max_failed integer,
  p_global_max_failed integer default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  since timestamptz;
  failed integer;
  attempt_id bigint;
begin
  if p_visitor_hash is null or p_visitor_hash = ''
    or p_kind is null or p_kind not in ('code', 'sign_in')
    or p_window_minutes is null or p_window_minutes < 1
    or p_max_failed is null or p_max_failed < 1
    or (p_global_max_failed is not null and p_global_max_failed < 1) then
    raise exception 'take_attempt: bad arguments';
  end if;

  -- One lock per kind, so both the visitor's count and the global count are
  -- exact. Tries at the door are few; serialising them costs nothing.
  perform pg_advisory_xact_lock(hashtext('access.attempts'), hashtext(p_kind));

  since := now() - make_interval(mins => p_window_minutes);

  select count(*) into failed
  from access.attempts a
  where a.visitor_hash = p_visitor_hash
    and a.kind = p_kind
    and not a.succeeded
    and a.created_at >= since;
  if failed >= p_max_failed then
    return null;
  end if;

  if p_global_max_failed is not null then
    select count(*) into failed
    from access.attempts a
    where a.kind = p_kind
      and not a.succeeded
      and a.created_at >= since;
    if failed >= p_global_max_failed then
      return null;
    end if;
  end if;

  insert into access.attempts (visitor_hash, kind, succeeded)
  values (p_visitor_hash, p_kind, false)
  returning id into attempt_id;
  return attempt_id;
end;
$$;

revoke all on function access.take_attempt(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function access.take_attempt(text, text, integer, integer, integer)
  to service_role;
