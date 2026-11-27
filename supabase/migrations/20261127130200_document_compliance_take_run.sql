-- Document compliance: a Pre-screen run is counted and created in one
-- transaction, under an advisory lock, so two requests at once cannot both
-- take the last place in the hour or the day.
--
-- Additive only: a new function. The code deployed before it keeps counting
-- and inserting separately; the code that calls this needs it applied first.

-- Creates a queued run and returns its id, or why it was refused. The limits
-- are passed in from RATE_LIMITS in server/rate-limit.ts; a trusted visitor
-- (the e2e suite) passes nulls and is never refused.
create function document_compliance.create_prescreen_run(
  p_owner text,
  p_visitor_hash text,
  p_pack_slug text,
  p_rulebook_id text,
  p_rulebook_version text,
  p_client_declaration jsonb,
  p_rules_applied jsonb,
  p_model text,
  p_per_visitor_per_hour integer,
  p_per_day integer
)
returns table (run_id uuid, refusal text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  used integer;
  created uuid;
begin
  -- One lock for the whole demo: the daily cap is global, and runs start
  -- seldom enough that serialising their start costs nothing.
  perform pg_advisory_xact_lock(hashtextextended('document_compliance:runs', 0));

  if p_per_visitor_per_hour is not null then
    select count(*) into used
    from document_compliance.prescreen_runs r
    where r.visitor_hash = p_visitor_hash
      and r.created_at > now() - interval '1 hour';
    if used >= p_per_visitor_per_hour then
      return query select null::uuid, 'visitor'::text;
      return;
    end if;
  end if;

  if p_per_day is not null then
    select count(*) into used
    from document_compliance.prescreen_runs r
    where r.created_at > now() - interval '1 day';
    if used >= p_per_day then
      return query select null::uuid, 'day'::text;
      return;
    end if;
  end if;

  insert into document_compliance.prescreen_runs (
    pack_slug, rulebook_id, rulebook_version, client_declaration,
    rules_applied, visitor_hash, owner, model, status
  ) values (
    p_pack_slug, p_rulebook_id, p_rulebook_version, p_client_declaration,
    p_rules_applied, p_visitor_hash, p_owner, p_model, 'queued'
  )
  returning id into created;

  return query select created, null::text;
end;
$$;

revoke all on function document_compliance.create_prescreen_run(text, text, text, text, text, jsonb, jsonb, text, integer, integer) from public, anon, authenticated;
grant execute on function document_compliance.create_prescreen_run(text, text, text, text, text, jsonb, jsonb, text, integer, integer) to service_role;
