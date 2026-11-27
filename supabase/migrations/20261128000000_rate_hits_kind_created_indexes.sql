-- The shared rate limiter (`src/platform/rate/limiter.ts`) counts a kind's
-- hits over the last day in one query: one visitor's (served by the existing
-- `(visitor_hash, kind, created_at)` indexes) and everyone's, which filters
-- by kind and time only. Without this index the everyone-count scanned the
-- whole kind. Helio (`bucket, created_at`) and Switchboard already have one;
-- Ledger has no kind column. Additive: safe for the code already deployed.

create index if not exists rate_hits_kind_created_idx
  on floorwalk.rate_hits (kind, created_at desc);
create index if not exists rate_hits_kind_created_idx
  on vellum.rate_hits (kind, created_at desc);
create index if not exists rate_hits_kind_created_idx
  on harness.rate_hits (kind, created_at desc);
create index if not exists rate_hits_kind_created_idx
  on canvas.rate_hits (kind, created_at desc);
create index if not exists rate_hits_kind_created_idx
  on bank.rate_hits (kind, created_at desc);
create index if not exists rate_hits_kind_created_idx
  on prism.rate_hits (kind, created_at desc);
