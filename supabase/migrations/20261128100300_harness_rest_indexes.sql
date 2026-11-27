-- Harness: indexes for the reads the REST services make on every request.
--
-- 1. The shared rate limiter (`pgRateLimiter`, src/platform/rate/limiter.ts)
--    counts a kind's hits of the last day in one query
--    (`where kind = $1 and created_at > now() - interval '1 day'`, the
--    visitor's share in a FILTER), on every message, Run, Source, search
--    and Sandbox command. The only index, `rate_hits_visitor_idx`, leads
--    with the visitor hash, so that count scanned the whole table.
-- 2. Every Sources list and read first fails reads that died
--    (`update harness.sources ... where owner = $1 and status = 'reading'`,
--    `knowledgeRepository.clearStale`). It almost never matches a row; a
--    partial index makes it a probe instead of a walk of the Owner's Sources.
--
-- Additive only: safe to apply before or after the code that reads it.

create index if not exists rate_hits_kind_created_idx
  on harness.rate_hits (kind, created_at desc);

create index if not exists sources_reading_idx
  on harness.sources (owner)
  where status = 'reading';
