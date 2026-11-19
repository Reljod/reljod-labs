-- Tidewater Bank: when a Growth request's GitHub issue was filed (or claimed
-- for filing). The daily issue cap counts on this, under an advisory lock,
-- instead of on `updated_at`, which every status sync moves.
-- Purely additive: one nullable column, and a backfill for requests filed
-- before it existed. Safe to run more than once.

alter table bank.growth_requests
  add column if not exists issue_filed_at timestamptz;

update bank.growth_requests
set issue_filed_at = created_at
where issue_number is not null and issue_filed_at is null;
