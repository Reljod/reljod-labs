-- Harness Knowledge base: additive columns for reading a Source (ADR 0016).
--
-- Additive and safe for code already deployed: nullable columns and one
-- partial unique index. Nothing is dropped or rewritten.
--
-- `harness.search_passages` (20261117120000_harness.sql) needs no change: a
-- null `p_embedding` leaves the `semantic` CTE empty and Passages with a null
-- embedding never enter it, so search still answers by words alone.

alter table harness.sources
  -- The text read from the file, cached so a case paper read twice is parsed
  -- once and a retry of ingest does not download the file again.
  add column if not exists extracted_text text
    check (extracted_text is null or char_length(extracted_text) <= 400000),
  -- When the current read began; a read older than a few minutes is stale and
  -- may be claimed again, so a Source is never stuck in `reading`.
  add column if not exists reading_at timestamptz,
  -- Reads attempted, so a failing file cannot be retried without end (it costs model calls).
  add column if not exists read_attempts smallint not null default 0,
  -- Names a seed Source (`employer-guide`) so topping up a Workspace's seed is idempotent.
  add column if not exists seed_key text
    check (seed_key is null or char_length(seed_key) between 1 and 80);

create unique index if not exists sources_seed_key_idx
  on harness.sources (owner, seed_key)
  where seed_key is not null;

-- Passages still waiting for an embedding (seed Passages are inserted without
-- one and embedded after the response; see `backfillKnowledge`).
create index if not exists passages_unembedded_idx
  on harness.passages (owner, id)
  where embedding is null;
