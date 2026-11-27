-- Purging an Owner also purges their files in Storage.
--
-- Was: `access.purge_owner` deleted an Owner's rows and left every file they
-- uploaded in the demos' private buckets. A row cannot delete a Storage
-- object (deleting from `storage.objects` in SQL leaves the bytes behind), so
-- the purge now queues the Owner's Storage prefixes in `access.storage_purge`,
-- and a Vercel cron route (`/api/cron/storage-purge`) drains the queue through
-- the Storage API with the service role.
--
-- A prefix ending in '/' is a folder (every object under it goes); any other
-- is one object. Every prefix has at least two segments, so a bad row can
-- never name a whole bucket or a whole top-level folder.
--
-- A demo that purges its own soft-deleted rows later queues their files with
-- `access.enqueue_storage_purge(bucket, prefix)` before deleting the rows.
--
-- Additive: a new table and new functions; `purge_owner` keeps its signature
-- and still deletes the same rows.

create table access.storage_purge (
  id bigint generated always as identity primary key,
  bucket text not null check (char_length(bucket) between 1 and 100),
  prefix text not null check (
    char_length(prefix) between 3 and 1024
    and prefix ~ '^[^/]+/[^/]+'
    and position('..' in prefix) = 0
  ),
  queued_at timestamptz not null default now(),
  unique (bucket, prefix)
);

create index storage_purge_queued_at_idx on access.storage_purge (queued_at, id);

alter table access.storage_purge enable row level security;
-- No policies: only the service role, which bypasses RLS, reads or writes it.
revoke all on access.storage_purge from public, anon, authenticated;
grant all on access.storage_purge to service_role;

-- Queues one prefix. A prefix that is not a safe one is skipped, not raised:
-- a purge never fails over a file name.
create function access.enqueue_storage_purge(p_bucket text, p_prefix text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_bucket is null or p_prefix is null
    or char_length(p_bucket) not between 1 and 100
    or char_length(p_prefix) not between 3 and 1024
    or p_prefix !~ '^[^/]+/[^/]+'
    or position('..' in p_prefix) > 0 then
    return;
  end if;
  insert into access.storage_purge (bucket, prefix)
  values (p_bucket, p_prefix)
  on conflict (bucket, prefix) do nothing;
end;
$$;

-- The folder a demo derives from an Owner: the first 32 hex characters of
-- sha256('<demo>:<owner>'), as `ownerFolder` in Loupe, Sieve and Operator.
create function access.owner_folder(p_demo text, p_owner text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select left(encode(sha256(convert_to(p_demo || ':' || p_owner, 'UTF8')), 'hex'), 32)
$$;

-- Queues the prefixes a query over a demo's rows names, when that demo's
-- table exists (each demo's migration may or may not have run). Internal to
-- `enqueue_owner_storage`: the query text is a constant written below.
create function access.enqueue_storage_from(
  p_bucket text,
  p_table text,
  p_query text,
  p_owner text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if to_regclass(p_table) is null then
    return;
  end if;
  execute format(
    'insert into access.storage_purge (bucket, prefix)
     select %L, q.prefix from (%s) q (prefix)
     where q.prefix is not null
       and char_length(q.prefix) between 3 and 1024
       and q.prefix ~ ''^[^/]+/[^/]+''
       and position(''..'' in q.prefix) = 0
     on conflict (bucket, prefix) do nothing',
    p_bucket,
    p_query
  ) using p_owner;
end;
$$;

-- Every Storage prefix that holds an Owner's files, as each demo lays them
-- out. Keep in step with the demos' storage code (docs/engineering/access.md).
create function access.enqueue_owner_storage(p_owner text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  harness_owner text;
begin
  if p_owner is null or p_owner = '' then
    return;
  end if;

  -- Folders named after the Owner.
  -- Harness: `owners/<owner, lowercased, first ':' to '-', [a-z0-9-] only>/`.
  harness_owner := regexp_replace(
    regexp_replace(lower(p_owner), ':', '-'), '[^a-z0-9-]', '', 'g'
  );
  if harness_owner <> '' then
    perform access.enqueue_storage_purge('harness', 'owners/' || harness_owner || '/');
  end if;
  -- Handover: `recordings/<owner, first ':' to '-'>/`.
  perform access.enqueue_storage_purge(
    'process-transfer', 'recordings/' || regexp_replace(p_owner, ':', '-') || '/'
  );
  -- Loupe: Uploads and Examination files under a hashed Owner folder.
  perform access.enqueue_storage_purge('loupe', 'u/' || access.owner_folder('loupe', p_owner) || '/');
  perform access.enqueue_storage_purge('loupe', 'x/' || access.owner_folder('loupe', p_owner) || '/');
  -- Sieve: `uploads/<hashed Owner>/`.
  perform access.enqueue_storage_purge(
    'name-extraction', 'uploads/' || access.owner_folder('name-extraction', p_owner) || '/'
  );
  -- Operator: Manifests under a hashed Owner folder.
  perform access.enqueue_storage_purge(
    'operator', 'manifests/' || access.owner_folder('operator', p_owner) || '/'
  );

  -- Folders named after one of the Owner's rows, read before they go.
  perform access.enqueue_storage_from(
    'casework', 'casework.sessions',
    $q$select 'uploads/' || s.id::text || '/' from casework.sessions s where s.owner = $1$q$,
    p_owner
  );
  perform access.enqueue_storage_from(
    'client-manager', 'client_manager.clients',
    $q$select 'clients/' || c.id::text || '/' from client_manager.clients c where c.owner = $1$q$,
    p_owner
  );
  perform access.enqueue_storage_from(
    'operator', 'operator.runs',
    $q$select 'frames/' || r.id::text || '/' from operator.runs r where r.owner = $1$q$,
    p_owner
  );
  perform access.enqueue_storage_from(
    'canvas', 'canvas.uploads',
    $q$select u.storage_path from canvas.uploads u where u.owner = $1$q$,
    p_owner
  );
  -- Floorwalk's uploads (`uploads/<hour>/<owner>/`) expire within hours on
  -- their own, so they are not queued here.
end;
$$;

-- As before (20261115120000_access_owners.sql), and the Owner's Storage
-- prefixes are queued first, while the rows that name them still exist.
create or replace function access.purge_owner(p_owner text)
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
  perform access.enqueue_owner_storage(p_owner);
  for owned in select ot.table_name from access.owned_tables ot loop
    execute format('delete from %s where owner = $1', owned) using p_owner;
  end loop;
end;
$$;

-- The next objects to remove: up to p_objects names from the oldest queued
-- prefixes. A queued prefix with nothing left under it is done and deleted.
create function access.storage_purge_batch(
  p_rows integer default 20,
  p_objects integer default 500
)
returns table (bucket text, name text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job record;
begin
  for job in
    select q.id, q.bucket, q.prefix
    from access.storage_purge q
    order by q.queued_at, q.id
    limit greatest(1, least(coalesce(p_rows, 20), 100))
    for update skip locked
  loop
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = job.bucket
        and case
          when right(job.prefix, 1) = '/' then starts_with(o.name, job.prefix)
          else o.name = job.prefix
        end
    ) then
      delete from access.storage_purge q where q.id = job.id;
    end if;
  end loop;

  return query
    select o.bucket_id::text, o.name::text
    from access.storage_purge q
    join storage.objects o
      on o.bucket_id = q.bucket
      and case
        when right(q.prefix, 1) = '/' then starts_with(o.name, q.prefix)
        else o.name = q.prefix
      end
    order by q.queued_at, q.id, o.name
    limit greatest(1, least(coalesce(p_objects, 500), 1000));
end;
$$;

revoke all on function access.enqueue_storage_purge(text, text) from public, anon, authenticated;
revoke all on function access.owner_folder(text, text) from public, anon, authenticated;
revoke all on function access.enqueue_storage_from(text, text, text, text) from public, anon, authenticated;
revoke all on function access.enqueue_owner_storage(text) from public, anon, authenticated;
revoke all on function access.storage_purge_batch(integer, integer) from public, anon, authenticated;
grant execute on function access.enqueue_storage_purge(text, text) to service_role;
grant execute on function access.owner_folder(text, text) to service_role;
grant execute on function access.enqueue_storage_from(text, text, text, text) to service_role;
grant execute on function access.enqueue_owner_storage(text) to service_role;
grant execute on function access.storage_purge_batch(integer, integer) to service_role;
