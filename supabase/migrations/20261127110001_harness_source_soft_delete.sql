-- Harness: removing a Source is a soft delete (AGENTS.md, "Deletes are soft").
--
-- Was: `removeSource` deleted the row, its Passages (and their Conflicts) by
-- cascade, and its file. Now it sets `deleted_at`; every read, list and
-- search leaves the Source out, and `purgeRemovedSources` (server code)
-- deletes the row and its file 30 days later. The cron below deletes removed
-- Sources that have no file; one with a file waits for the app, which
-- removes the file with the row.
--
-- Additive. Apply this before the code that reads `deleted_at` deploys: that
-- code filters on the column and fails without it. The code already deployed
-- never sets it, so the replaced `search_passages` (same signature) answers
-- it exactly as before.

alter table harness.sources
  -- When a person removed the Source. Purged 30 days later.
  add column if not exists deleted_at timestamptz;

create index if not exists sources_deleted_at_idx
  on harness.sources (owner, deleted_at)
  where deleted_at is not null;

-- Hybrid search, as in 20261117120000_harness.sql, now also leaving out
-- removed Sources, and an open Conflict counts only while both its Passages'
-- Sources are still there.
create or replace function harness.search_passages(
  p_owner text,
  p_query text,
  p_embedding extensions.vector(768),
  p_limit integer default 8
)
returns table (
  passage_id bigint,
  source_id uuid,
  source_title text,
  source_kind text,
  document_date date,
  ordinal integer,
  heading text,
  body text,
  score double precision,
  semantic double precision,
  lexical real,
  conflict_open boolean
)
language sql
stable
set search_path = extensions, public
as $$
  with terms as (
    select nullif(
      array_to_string(array(
        -- Quoted for tsquery by hand: quote_literal would write E'..' for a
        -- lexeme with a backslash, and tsquery would read the E as a word.
        select '''' || replace(replace(lexeme, '\', '\\'), '''', '''''') || ''':*'
        from unnest(to_tsvector('english', p_query))
      ), ' | '),
      ''
    ) as tsq
  ),
  live as (
    select p.id, p.embedding, p.search
    from harness.passages p
    join harness.sources s on s.id = p.source_id
    where p.owner = p_owner and s.owner = p_owner
      and s.status = 'ready'
      and s.deleted_at is null
      and p.superseded_by is null
  ),
  semantic as (
    select l.id, 1 - (l.embedding <=> p_embedding) as similarity,
           row_number() over (order by l.embedding <=> p_embedding) as rank
    from live l
    where l.embedding is not null and p_embedding is not null
    order by l.embedding <=> p_embedding
    limit 30
  ),
  lexical as (
    select l.id, ts_rank_cd(l.search, to_tsquery('english', t.tsq)) as rank_score,
           row_number() over (order by ts_rank_cd(l.search, to_tsquery('english', t.tsq)) desc) as rank
    from live l, terms t
    where t.tsq is not null
      and l.search @@ to_tsquery('english', t.tsq)
    order by rank_score desc
    limit 30
  ),
  fused as (
    select coalesce(s.id, l.id) as id,
           coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + l.rank), 0) as score,
           s.similarity as semantic,
           l.rank_score as lexical
    from semantic s
    full join lexical l on l.id = s.id
    order by score desc, id
    limit greatest(1, least(p_limit, 25))
  )
  select p.id, p.source_id, src.title, src.kind, src.document_date,
         p.ordinal, p.heading, p.body,
         f.score::double precision, f.semantic, f.lexical,
         exists (
           select 1 from harness.conflicts c
           where c.status = 'open'
             and (c.new_passage_id = p.id or c.old_passage_id = p.id)
             and not exists (
               select 1 from harness.passages cp
               join harness.sources cs on cs.id = cp.source_id
               where cp.id in (c.new_passage_id, c.old_passage_id)
                 and cs.deleted_at is not null
             )
         )
  from fused f
  join harness.passages p on p.id = f.id
  join harness.sources src on src.id = p.source_id
  order by f.score desc, p.id;
$$;

-- Retention: removed Sources without a file go 30 days after removal ----------
-- (Passages and Conflicts cascade). Ones with a file are purged by the app.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'harness-purge-removed-sources',
      '51 3 * * *',
      $cron$delete from harness.sources where deleted_at < now() - interval '30 days' and storage_path is null$cron$
    );
  end if;
end;
$$;
