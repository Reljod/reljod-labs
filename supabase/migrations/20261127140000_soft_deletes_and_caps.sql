-- Soft deletes and spend caps for Client Manager, Canvas, Switchboard and
-- Prism. Additive only: new nullable columns, a new table, a widened check,
-- new indexes and cron jobs, so the code deployed before this keeps working.
-- Apply it before the code that reads `deleted_at`, `model_calls.owner`,
-- `switchboard.records_archive` or the `voice` rate kind is deployed.
--
-- A person's delete never removes their data on the spot (AGENTS.md, "Deletes
-- are soft"): it sets `deleted_at`, every read filters it out, and the rows go
-- 30 days later in the jobs below.

-- Client Manager --------------------------------------------------------------

alter table client_manager.clients add column if not exists deleted_at timestamptz;
alter table client_manager.threads add column if not exists deleted_at timestamptz;

-- Whose spend a model call was, when the caller knows (a chat answer). Builds
-- are counted through their client's owner. Feeds the per-Owner daily cap.
alter table client_manager.model_calls add column if not exists owner text;

create index if not exists model_calls_owner_idx
  on client_manager.model_calls (owner, created_at)
  where owner is not null;
create index if not exists model_calls_client_created_idx
  on client_manager.model_calls (client_id, created_at)
  where client_id is not null;
-- Everyone's questions today (the global ask cap).
create index if not exists messages_asks_created_idx
  on client_manager.messages (created_at)
  where role = 'user' and mode in ('ask', 'research');
create index if not exists builds_created_idx
  on client_manager.builds (created_at);
create index if not exists clients_deleted_idx
  on client_manager.clients (deleted_at)
  where deleted_at is not null;
create index if not exists threads_deleted_idx
  on client_manager.threads (deleted_at)
  where deleted_at is not null;

-- Canvas ----------------------------------------------------------------------

alter table canvas.conversations add column if not exists deleted_at timestamptz;
alter table canvas.views add column if not exists deleted_at timestamptz;

create index if not exists conversations_deleted_idx
  on canvas.conversations (deleted_at)
  where deleted_at is not null;
create index if not exists views_deleted_idx
  on canvas.views (deleted_at)
  where deleted_at is not null;

-- Switchboard -----------------------------------------------------------------

-- Records a Back office reset set aside. A reset re-seeds the same refs, so
-- the old rows cannot stay in `switchboard.records` under their keys; they
-- move here and are purged after 30 days. Goes with the Workspace.
create table if not exists switchboard.records_archive (
  id uuid not null,
  owner text not null references switchboard.workspaces (owner) on delete cascade,
  kind text not null,
  ref text not null,
  data jsonb not null,
  call_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz not null default now(),
  primary key (id, deleted_at)
);

create index if not exists records_archive_owner_idx
  on switchboard.records_archive (owner, deleted_at desc);
create index if not exists records_archive_deleted_idx
  on switchboard.records_archive (deleted_at);

alter table switchboard.records_archive enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on switchboard.records_archive from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on switchboard.records_archive to service_role';
  end if;
end;
$$;

-- A voice Call also takes a `voice` hit, counted per Owner and for everyone
-- per day (ADR 0029). Widening the check keeps every existing row valid.
alter table switchboard.rate_hits drop constraint if exists rate_hits_kind_check;
alter table switchboard.rate_hits
  add constraint rate_hits_kind_check
  check (kind in ('call', 'turn', 'supervisor', 'sandbox', 'voice'));

create index if not exists rate_hits_owner_kind_idx
  on switchboard.rate_hits (owner, kind, created_at desc);
create index if not exists rate_hits_kind_created_idx
  on switchboard.rate_hits (kind, created_at desc);

-- Prism -----------------------------------------------------------------------

-- Everyone's Decision Model calls today (the global daily cap).
create index if not exists rate_hits_created_idx
  on prism.rate_hits (created_at);

-- Purge, 30 days after a soft delete ----------------------------------------
--
-- Client Manager clients are not purged here: their files are in Storage,
-- which SQL cannot empty, so the app removes the folder and then the row
-- (`purgeDeletedClients`, after a Catalog read). The existing
-- `client-manager-delete-expired-clients` job still ends every client 30 days
-- after it was made, deleted or not.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'client-manager-purge-deleted-threads',
      '23 4 * * *',
      $cron$delete from client_manager.threads where deleted_at < now() - interval '30 days'$cron$
    );
    perform cron.schedule(
      'canvas-purge-deleted',
      '27 4 * * *',
      $cron$
        delete from canvas.views where deleted_at < now() - interval '30 days';
        delete from canvas.conversations where deleted_at < now() - interval '30 days';
      $cron$
    );
    perform cron.schedule(
      'switchboard-purge-archived-records',
      '31 4 * * *',
      $cron$delete from switchboard.records_archive where deleted_at < now() - interval '30 days'$cron$
    );
    -- Rate rows are read for a day at most.
    perform cron.schedule(
      'switchboard-delete-old-rate-hits',
      '33 4 * * *',
      $cron$delete from switchboard.rate_hits where created_at < now() - interval '2 days'$cron$
    );
  end if;
end;
$$;
