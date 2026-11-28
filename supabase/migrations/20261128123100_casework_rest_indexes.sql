-- Casework: an index for the one Desk lookup that scanned the whole table.
--
-- The outside MCP client's shared desk is found on every one of its calls
-- (`externalSession` in src/features/casework/server/repository.ts):
--
--   select id from casework.sessions
--   where visitor_hash = 'mcp-external'
--   order by created_at desc
--   limit 1
--
-- casework.sessions had no index on visitor_hash, so each call read every
-- Desk. Every other Casework read already has one (sessions by Owner and
-- last activity, documents by Case file and Desk, messages, runs, questions
-- and model calls by their parent).
--
-- Additive only: the deployed code keeps working before and after.

create index if not exists sessions_visitor_hash_created_at_idx
  on casework.sessions (visitor_hash, created_at desc);
