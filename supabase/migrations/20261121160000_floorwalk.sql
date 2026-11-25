-- Floorwalk: a model watches body-camera footage of a site walk; code checks
-- what it reports against the Standard. Floorwalk keeps no saved data (a Walk
-- lives in the visitor's browser), so the only table is the rate limiter's.
-- It holds no Owner and is not in access.owned_tables; rows older than a day
-- are deleted as new ones come in. Uploaded footage goes to the private
-- `floorwalk` bucket under uploads/<UTC hour>/<owner>/; the app sweeps hour folders
-- older than six hours after the next visit, Walk, Ask or upload.

create schema if not exists floorwalk;

create table if not exists floorwalk.rate_hits (
  id bigint generated always as identity primary key,
  -- Salted hash of the visitor's IP, used only for rate limiting.
  visitor_hash text not null,
  kind text not null check (kind in ('walk', 'ask', 'upload')),
  created_at timestamptz not null default now()
);

create index if not exists rate_hits_visitor_idx
  on floorwalk.rate_hits (visitor_hash, kind, created_at desc);
create index if not exists rate_hits_created_idx
  on floorwalk.rate_hits (created_at);

alter table floorwalk.rate_hits enable row level security;
-- No policies: anon and authenticated see nothing. The app connects as the
-- database owner, which bypasses RLS.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema floorwalk from anon, authenticated';
    execute 'revoke all on all tables in schema floorwalk from anon, authenticated';
  end if;
end;
$$;

-- Storage: private bucket for uploaded footage (25 MB, MP4 or MOV).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('floorwalk', 'floorwalk', false, 26214400, array['video/mp4', 'video/quicktime'])
    on conflict (id) do nothing;
  end if;
end;
$$;
