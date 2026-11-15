-- Pre-screen runs and Ask sessions belong to an Owner (ADR 0011), not to a
-- browser cookie: 'host:<auth user id>', 'guest:<guest pass id>' or 'e2e'.
-- Rows from before Owners keep a null owner and are shown to nobody; they
-- still expire as before. Purging an Owner (access.purge_owner) deletes their
-- runs and sessions; Documents, Findings and Builds go with them by cascade.

alter table document_compliance.prescreen_runs add column owner text;

create index prescreen_runs_owner_created_at_idx
  on document_compliance.prescreen_runs (owner, created_at desc)
  where owner is not null;

alter table ledger.ask_sessions add column owner text;

create index ask_sessions_owner_created_at_idx
  on ledger.ask_sessions (owner, created_at desc)
  where owner is not null;

insert into access.owned_tables (table_name)
values
  ('document_compliance.prescreen_runs'::regclass),
  ('ledger.ask_sessions'::regclass)
on conflict do nothing;
