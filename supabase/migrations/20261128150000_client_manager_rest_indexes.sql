-- Client Manager: indexes for the caps every paid request counts.
--
-- Every Build, question and Research turn takes its place under the caps
-- (`usageFor` in server/repository.ts, inside the locked transaction of
-- `pgCaps.take`), and every MCP search checks the visitor's day of spend
-- (`usageSince`). Both count one visitor's rows of the last hour or day:
--
--   messages    where role = 'user' and mode in ('ask', 'research')
--               and visitor_hash = $1 and created_at >= now() - 1 hour
--   model_calls where visitor_hash = $1 and created_at >= now() - 1 day
--
-- Neither had an index on the visitor, so each count scanned every
-- question or model call of the window for everyone, while holding the
-- caps' advisory locks. The global counts keep their own indexes
-- (`messages_asks_created_idx`, `builds_created_idx`); Builds per visitor
-- already have `builds_visitor_idx`.
--
-- Additive only: safe to apply before or after the code that uses them.

create index if not exists messages_visitor_asks_idx
  on client_manager.messages (visitor_hash, created_at)
  where role = 'user' and mode in ('ask', 'research');

create index if not exists model_calls_visitor_created_idx
  on client_manager.model_calls (visitor_hash, created_at);
