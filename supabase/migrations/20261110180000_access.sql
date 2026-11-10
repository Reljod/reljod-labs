-- Access: who may open the demos. A Host (a Supabase Auth account) issues
-- Guest passes; a Guest redeems the pass's code and becomes an anonymous
-- Supabase Auth user bound to that pass until it expires or is revoked.
-- Accessed only from server code with the service role; never from the browser.
-- The `access` schema must be listed under Data API > Exposed schemas.

create schema if not exists access;

create table access.guest_passes (
  id uuid primary key default gen_random_uuid(),
  -- Who the pass is for, as the Host wrote it.
  label text not null check (char_length(label) between 1 and 60),
  -- SHA-256 of the Guest code. The code itself is shown once and never stored.
  code_hash text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- How many browsers may redeem the code.
  max_devices integer not null check (max_devices between 1 and 5),
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);

create index guest_passes_created_by_idx on access.guest_passes (created_by);
create index guest_passes_expires_at_idx on access.guest_passes (expires_at);

-- One row per browser that redeemed a code: its anonymous Auth user.
create table access.guest_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  guest_pass_id uuid not null references access.guest_passes (id) on delete cascade,
  -- Salted hash of the visitor's IP, as in the demos' rate limits.
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index guest_sessions_guest_pass_id_idx on access.guest_sessions (guest_pass_id);

-- Tries at the door, so wrong codes and passwords can be slowed down.
create table access.attempts (
  id bigint generated always as identity primary key,
  visitor_hash text not null,
  kind text not null check (kind in ('code', 'sign_in')),
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

create index attempts_visitor_hash_kind_created_at_idx
  on access.attempts (visitor_hash, kind, created_at);
create index attempts_created_at_idx on access.attempts (created_at);

-- Redeeming -------------------------------------------------------------------

-- Binds an Auth user to the pass a code names, if the pass is live and has a
-- device to spare. Locks the pass, so two browsers cannot take the last device.
-- Returns no row when the code is refused.
create function access.redeem_guest_pass(
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

  if not found or pass.revoked_at is not null or pass.expires_at <= now() then
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

-- Access: service role only ----------------------------------------------------

alter table access.guest_passes enable row level security;
alter table access.guest_sessions enable row level security;
alter table access.attempts enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.
-- Guests are anonymous Auth users, which carry the `authenticated` role, so
-- nothing here may ever be granted to `authenticated`.

revoke all on schema access from anon, authenticated;
grant usage on schema access to service_role;
grant all on all tables in schema access to service_role;
alter default privileges in schema access grant all on tables to service_role;

revoke all on function access.redeem_guest_pass(text, uuid, text) from public, anon, authenticated;
grant execute on function access.redeem_guest_pass(text, uuid, text) to service_role;

-- Retention -------------------------------------------------------------------

create extension if not exists pg_cron;

select cron.schedule(
  'access-delete-old-attempts',
  '41 3 * * *',
  $$delete from access.attempts where created_at < now() - interval '1 day'$$
);

-- Guest sessions cascade with their pass.
select cron.schedule(
  'access-delete-old-guest-passes',
  '43 3 * * *',
  $$delete from access.guest_passes where expires_at < now() - interval '30 days'$$
);

-- Anonymous Auth users whose Guest pass is over (or who never got one) are of
-- no use: they cannot sign in again. A user on a live pass is never touched.
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
        and gp.revoked_at is null
        and gp.expires_at > now()
    )
  $$
);
