-- Tidewater Bank: a deleted Teller conversation is soft-deleted, and the
-- bank's rate hits are cleaned up.
--
-- * `bank.sessions.deleted_at`: deleting a conversation sets it (a user
--   action on a Guest pass never hard-deletes an Owner's data). Every read
--   of sessions and messages skips a deleted conversation; a daily job
--   purges it, with its messages (they cascade), 30 days later.
-- * `bank.rate_hits`: rows are only read for the last hour. They are now
--   deleted after a day, and the table is registered in
--   `access.owned_tables` so purging an Owner reaches it too.
--
-- Purely additive: a nullable column, an index, a registration and two cron
-- jobs. Apply it before the code that filters on `deleted_at` deploys.

alter table bank.sessions add column if not exists deleted_at timestamptz;

create index if not exists sessions_deleted_at_idx on bank.sessions (deleted_at)
  where deleted_at is not null;

insert into access.owned_tables values ('bank.rate_hits') on conflict do nothing;

create index if not exists rate_hits_created_at_idx on bank.rate_hits (created_at);

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'bank-purge-deleted-sessions',
      '23 3 * * *',
      $cron$delete from bank.sessions where deleted_at < now() - interval '30 days'$cron$
    );
    perform cron.schedule(
      'bank-delete-old-rate-hits',
      '41 3 * * *',
      $cron$delete from bank.rate_hits where created_at < now() - interval '1 day'$cron$
    );
  else
    raise notice 'pg_cron is not available: delete bank.sessions soft-deleted over 30 days ago and bank.rate_hits older than a day by hand.';
  end if;
end;
$$;
