-- Access: the index the Host's Guest pass list reads by.
--
-- `/access/guests` (GuestPassService.list → listGuestPasses) reads
--   select … from access.guest_passes p order by p.created_at desc limit 100
-- with each pass's device count from guest_sessions (already indexed on
-- guest_pass_id). Without an index on created_at that is a full scan and a
-- sort on every visit; with it, the newest hundred are read in order.
--
-- Additive only: the deployed code keeps working before and after.

create index if not exists guest_passes_created_at_idx
  on access.guest_passes (created_at desc);
