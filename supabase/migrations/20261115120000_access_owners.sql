-- Owners and Guest pass retention (ADR 0011).
--
-- Saved demo data belongs to an Owner, written as text in an `owner` column:
-- 'host:<auth user id>', 'guest:<guest pass id>' or 'e2e'. A Guest's data
-- belongs to their Guest pass, not to the anonymous Auth user, so it outlives
-- the user, a new Guest code and an extension.
--
-- A Host may extend or renew a pass, give it a new Guest code, and delete it.
-- Deleting only marks the pass; 30 days later the pass and everything its
-- Guests saved is purged. Until then the Host can restore it.

alter table access.guest_passes
  -- When the pass was last extended or renewed; bounds how far it may run.
  add column renewed_at timestamptz,
  -- When the Host deleted the pass. Purged with its data 30 days later.
  add column deleted_at timestamptz;

-- Was: expires_at <= created_at + 7 days, which made extending impossible.
alter table access.guest_passes drop constraint if exists guest_passes_check;
alter table access.guest_passes
  add constraint guest_passes_duration_check
  check (
    expires_at > created_at
    and expires_at <= coalesce(renewed_at, created_at) + interval '7 days'
  );

create index guest_passes_deleted_at_idx on access.guest_passes (deleted_at)
  where deleted_at is not null;

-- Redeeming: a deleted pass opens nothing. Otherwise as before.
create or replace function access.redeem_guest_pass(
  p_code_hash text,
  p_user_id uuid,
  p_visitor_hash text
)
returns table (pass_id uuid, pass_label text, pass_expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pass access.guest_passes%rowtype;
  taken integer;
begin
  select gp.* into pass
  from access.guest_passes gp
  where gp.code_hash = p_code_hash
  for update;

  if not found
    or pass.deleted_at is not null
    or pass.revoked_at is not null
    or pass.expires_at <= now() then
    return;
  end if;

  select count(*) into taken
  from access.guest_sessions gs
  where gs.guest_pass_id = pass.id and gs.user_id <> p_user_id;

  if taken >= pass.max_devices then
    return;
  end if;

  insert into access.guest_sessions as gs (user_id, guest_pass_id, visitor_hash)
  values (p_user_id, pass.id, p_visitor_hash)
  on conflict (user_id) do update
    set guest_pass_id = excluded.guest_pass_id,
        visitor_hash = excluded.visitor_hash,
        created_at = now();

  return query select pass.id, pass.label, pass.expires_at;
end;
$$;

revoke all on function access.redeem_guest_pass(text, uuid, text) from public, anon, authenticated;
grant execute on function access.redeem_guest_pass(text, uuid, text) to service_role;

-- Owned tables ----------------------------------------------------------------

-- Every table that holds an Owner's top-level rows registers here, so purging
-- an Owner reaches it. Child rows go with their parent by `on delete cascade`.
-- A demo migration that adds an `owner` column inserts its table here.
create table access.owned_tables (
  table_name regclass primary key
);

alter table access.owned_tables enable row level security;

-- Deletes every row an Owner saved, in every registered table.
create function access.purge_owner(p_owner text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owned regclass;
begin
  if p_owner is null or p_owner = '' then
    return;
  end if;
  for owned in select ot.table_name from access.owned_tables ot loop
    execute format('delete from %s where owner = $1', owned) using p_owner;
  end loop;
end;
$$;

-- Guest passes deleted more than 30 days ago, with their Guests' data.
create function access.purge_deleted_guest_passes()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pass_id uuid;
  purged integer := 0;
begin
  for pass_id in
    select gp.id
    from access.guest_passes gp
    where gp.deleted_at < now() - interval '30 days'
  loop
    perform access.purge_owner('guest:' || pass_id::text);
    -- Guest sessions cascade with the pass.
    delete from access.guest_passes gp where gp.id = pass_id;
    purged := purged + 1;
  end loop;
  return purged;
end;
$$;

revoke all on function access.purge_owner(text) from public, anon, authenticated;
revoke all on function access.purge_deleted_guest_passes() from public, anon, authenticated;
grant execute on function access.purge_owner(text) to service_role;
grant execute on function access.purge_deleted_guest_passes() to service_role;
grant all on access.owned_tables to service_role;

-- Retention -------------------------------------------------------------------

-- Was: delete passes 30 days after they expired, which would have left their
-- Guests' data behind. Now an ended pass is deleted, and purged 30 days later.
select cron.unschedule('access-delete-old-guest-passes')
where exists (
  select 1 from cron.job where jobname = 'access-delete-old-guest-passes'
);

select cron.schedule(
  'access-delete-ended-guest-passes',
  '43 3 * * *',
  $$
  update access.guest_passes
  set deleted_at = now()
  where deleted_at is null
    and least(coalesce(revoked_at, expires_at), expires_at) < now() - interval '30 days'
  $$
);

select cron.schedule(
  'access-purge-deleted-guest-passes',
  '45 3 * * *',
  $$select access.purge_deleted_guest_passes()$$
);

-- As before, and a deleted pass keeps nobody.
select cron.schedule(
  'access-delete-spent-guests',
  '47 3 * * *',
  $$
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '1 day'
    and not exists (
      select 1
      from access.guest_sessions gs
      join access.guest_passes gp on gp.id = gs.guest_pass_id
      where gs.user_id = u.id
        and gp.deleted_at is null
        and gp.revoked_at is null
        and gp.expires_at > now()
    )
  $$
);
