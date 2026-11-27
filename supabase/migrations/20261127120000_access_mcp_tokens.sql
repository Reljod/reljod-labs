-- MCP tokens of the demos (Client Manager, Harness): revocation and
-- single-use authorization codes. Additive: the deployed code reads neither
-- table, and the new code treats a missing table as "nothing revoked, no
-- code used yet", so either may deploy first.

-- Token epochs ----------------------------------------------------------------

-- "Disconnect all MCP clients": every MCP token, refresh token and pasted
-- token an Owner was issued at or before `not_before` is refused. Tokens
-- carry their issue time (`iat`); one minted before they did is refused once
-- its Owner has an epoch. One row per Owner, moved forward on each press.
create table access.token_epochs (
  owner text primary key,
  not_before timestamptz not null default now()
);

alter table access.token_epochs enable row level security;
grant all on access.token_epochs to service_role;

-- Purged with the Owner, like everything else it saved.
insert into access.owned_tables values ('access.token_epochs')
on conflict do nothing;

-- Redeemed authorization codes --------------------------------------------------

-- A code is a signed blob that lives two minutes. Its hash is recorded the
-- first time it is redeemed, so a second redemption is refused. Rows are
-- worth nothing after the code expires and are cleared as new codes come in.
create table access.redeemed_oauth_codes (
  code_hash text primary key,
  expires_at timestamptz not null
);

create index redeemed_oauth_codes_expires_at_idx
  on access.redeemed_oauth_codes (expires_at);

alter table access.redeemed_oauth_codes enable row level security;
grant all on access.redeemed_oauth_codes to service_role;

-- True the first time a code is redeemed, false ever after.
create function access.redeem_oauth_code(
  p_code_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed text;
begin
  delete from access.redeemed_oauth_codes rc
  where rc.expires_at < now() - interval '1 hour';

  insert into access.redeemed_oauth_codes (code_hash, expires_at)
  values (p_code_hash, p_expires_at)
  on conflict (code_hash) do nothing
  returning code_hash into claimed;

  return claimed is not null;
end;
$$;

revoke all on function access.redeem_oauth_code(text, timestamptz) from public, anon, authenticated;
grant execute on function access.redeem_oauth_code(text, timestamptz) to service_role;
