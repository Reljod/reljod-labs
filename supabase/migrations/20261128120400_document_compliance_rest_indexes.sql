-- Document compliance: indexes for the reads the REST services make.
-- Additive only: the deployed code keeps working without them.

-- Where a capped visitor lands: the Owner's newest finished run of a pack
-- (`latestCompletedId`: owner, pack_slug, status = 'completed', order by
-- completed_at desc). The older index has no owner, so it scanned every
-- Owner's finished runs of the pack.
create index if not exists prescreen_runs_owner_pack_completed_idx
  on document_compliance.prescreen_runs (owner, pack_slug, completed_at desc)
  where status = 'completed';

-- The Audit trail filtered by one action (`GET /api/document-compliance/audit
-- ?action=`: owner, action, id < before, order by id desc).
create index if not exists audit_events_owner_action_id_idx
  on document_compliance.audit_events (owner, action, id desc);
