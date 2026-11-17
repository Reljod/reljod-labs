-- Harness: count Knowledge searches that call the embedding model against the
-- visitor's hourly allowance (conventions.md, "Cap paid work at every entry point").
--
-- Safe for code already deployed: the constraint only widens. Until it is
-- applied, a capped search finds no place and searches by words alone.

alter table harness.rate_hits drop constraint if exists rate_hits_kind_check;
alter table harness.rate_hits add constraint rate_hits_kind_check
  check (kind in ('message', 'run', 'source', 'sandbox_command', 'search'));
