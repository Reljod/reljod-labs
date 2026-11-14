-- Client Manager: chat Threads across the whole book, research proposals, and
-- web research as a kind of Source.
--
-- The chat moved out of the Client page: a Thread belongs to a browser session
-- and asks about every client it may see, or about one (its scope). It reaches
-- the graphs only through the Client Manager MCP server.

create table client_manager.threads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  -- The client the Thread is about; null asks across every visible client.
  client_id uuid references client_manager.clients (id) on delete set null,
  title text not null default 'New chat'
    check (char_length(title) between 1 and 120),
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index threads_session_idx on client_manager.threads (session_id, updated_at desc);

alter table client_manager.threads enable row level security;

-- Messages now belong to a Thread. Messages from before Threads keep their
-- client and no Thread; a Thread's messages may have no client.
alter table client_manager.messages
  add column thread_id uuid references client_manager.threads (id) on delete cascade,
  -- Facts a research turn found, waiting for the person to choose which to add.
  add column proposal jsonb,
  alter column client_id drop not null;

alter table client_manager.messages drop constraint messages_mode_check;
alter table client_manager.messages
  add constraint messages_mode_check
  check (mode in ('ask', 'add', 'build', 'research'));

create index messages_thread_idx2 on client_manager.messages (thread_id, created_at)
  where thread_id is not null;

-- Facts added from web research keep their links in a Source of their own.
alter table client_manager.sources drop constraint sources_kind_check;
alter table client_manager.sources
  add constraint sources_kind_check
  check (kind in ('note', 'pdf', 'image', 'sheet', 'doc', 'text', 'web'));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on client_manager.threads from anon, authenticated';
  end if;
end;
$$;
