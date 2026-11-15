-- Client Manager: clients, Threads and messages belong to an Access Owner
-- (ADR 0011), not to a browser session cookie. A Host's browsers and a Guest
-- pass's devices each share one book, and a Guest's book outlives the
-- anonymous Auth user. Rows from before Owners keep `owner` null and are seen
-- by nobody, except sample clients, which stay open to everyone.

alter table client_manager.clients add column owner text;
alter table client_manager.threads add column owner text;
alter table client_manager.messages add column owner text;

-- New rows carry an Owner instead of a session.
alter table client_manager.threads alter column session_id drop not null;
alter table client_manager.messages alter column session_id drop not null;

create index clients_owner_idx on client_manager.clients (owner, created_at desc)
  where owner is not null;
create index threads_owner_idx on client_manager.threads (owner, updated_at desc)
  where owner is not null;

-- Purging an Owner reaches these. A message goes with its Thread or its
-- client by cascade; messages are registered too, so none is left behind
-- when it hangs off a sample client.
insert into access.owned_tables (table_name)
values
  ('client_manager.clients'),
  ('client_manager.threads'),
  ('client_manager.messages')
on conflict do nothing;
