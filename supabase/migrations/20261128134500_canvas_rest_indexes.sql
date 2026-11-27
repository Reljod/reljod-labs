-- Canvas: an index for the read the Under the hood place makes on every visit.
--
-- `GET /api/canvas/trail?conversationId=` (`trailRepository.list`) reads one
-- Conversation's page of the Trail:
--   where owner = $1 and conversation_id = $2 order by id desc limit 100
-- The existing indexes lead with (owner, id), (owner, question_id, id) and
-- (owner, view_id, id), so that read walked every event the Owner ever had,
-- newest first, until it found a hundred of the Conversation's. The Trail is
-- append-only and grows with every tool call and Run.
--
-- The rate limiter's count (`where kind = $1 and created_at > ...`) already
-- has `canvas.rate_hits (kind, created_at desc)` from
-- 20261128000000_rate_hits_kind_created_indexes.sql.
--
-- Additive only: safe to apply before or after the code that reads it.

create index if not exists events_conversation_idx
  on canvas.events (owner, conversation_id, id desc);
