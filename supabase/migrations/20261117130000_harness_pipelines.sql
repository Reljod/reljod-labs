-- Harness Pipelines: what the contribution checks need beyond the first
-- migration. Additive only, safe for code already deployed.
--
-- `started_work_on`: the day a Member started work in the Islands. The
-- nine-month Rule (`cp.nine-month`, National Pensions Act s.25(2)(a)) counts
-- from it for a Member who is neither Caymanian nor a permanent resident.
-- Null for Caymanians, residents and anyone whose start is not known; the
-- check then says nothing about them.

alter table harness.members
  add column if not exists started_work_on date;

-- `seedRecords` and the Pipelines look Members up by number within a
-- Workspace (`unique (owner, member_no)` already indexes that), Schedules by
-- Employer and month, and Remittances by Employer and month.
create index if not exists remittances_owner_period_idx
  on harness.remittances (owner, period);
create index if not exists schedules_owner_period_idx
  on harness.schedules (owner, period);
