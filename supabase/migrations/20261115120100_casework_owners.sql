-- Casework: a Desk belongs to an Owner (ADR 0011), not to the browser that
-- opened it. A Host's Desks follow them to any browser; a Guest's Desks belong
-- to their Guest pass, so every device on the pass shares them.
--
-- Desks from before this have no Owner and are shown to nobody. The shared
-- desk of an outside MCP client (CASEWORK_MCP_TOKEN) has none either.
-- Runs, Messages, uploaded Documents and model calls cascade from the Desk.

alter table casework.sessions add column owner text;

create index sessions_owner_last_active_at_idx
  on casework.sessions (owner, last_active_at desc)
  where owner is not null;

insert into access.owned_tables (table_name)
values ('casework.sessions')
on conflict do nothing;
