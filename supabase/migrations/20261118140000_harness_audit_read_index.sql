-- Harness: an index for the Audit tab's read.
--
-- The Audit trail pages newest first by event id (`order by e.id desc`,
-- `e.id < before`), scoped to one Owner (`listAudit` in
-- src/features/harness/server/audit.ts). The table is shared by every
-- Workspace, and the only index that leads with the Owner orders by
-- created_at, so Postgres either walked the primary key backwards through
-- every Workspace's events, filtering by Owner, or read all of the Owner's
-- events and sorted them, on every page and every 10-second refresh. This
-- index serves the whole-Workspace page and "Load more" directly.
--
-- Additive only: safe to apply before or after the code that reads it.

create index if not exists audit_events_owner_id_idx
  on harness.audit_events (owner, id desc);
