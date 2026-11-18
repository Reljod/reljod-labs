-- Client Manager: indexes for the reads that open a Client file.
--
-- Opening a Client file counts facts per Source (`evidence` by client_id),
-- sums the client's spend (`model_calls` by client_id), and opening a
-- Document lists the facts that quote it (`evidence` by source_id). None of
-- those columns had an index, so each read scanned the whole table, which
-- grows with every client and every model call. The same indexes serve the
-- `on delete cascade` from clients and sources, and buildSpend.
--
-- Additive only: safe to apply before or after the code that uses them.

create index if not exists evidence_client_source_idx
  on client_manager.evidence (client_id, source_id);

create index if not exists evidence_source_idx
  on client_manager.evidence (source_id);

create index if not exists model_calls_client_idx
  on client_manager.model_calls (client_id);

create index if not exists model_calls_build_idx
  on client_manager.model_calls (build_id);
