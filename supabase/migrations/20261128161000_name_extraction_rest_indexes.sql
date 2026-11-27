-- Sieve (name_extraction): an index for a read the REST services make often.
-- Additive only; the deployed code keeps working before and after.

-- A Run's latest Register while it goes: the preview (overview, every
-- 12-page chunk) and the comparison read
--   select … from run_events
--   where run_id = $1 and type = 'names'
--   order by seq desc limit 1
-- (`latestNames` in server/repository.ts). On `(run_id, seq)` that walks
-- the trail backwards, reading every tool, Reader, cost and log row since
-- the last `names` event (a whole fan-out of Readers, on a 500-page Run);
-- this partial index holds only the `names` events, so the read is one
-- index probe.
create index if not exists run_events_run_id_names_seq_idx
  on name_extraction.run_events (run_id, seq desc)
  where type = 'names';
