-- A Pre-screen run executes as a Vercel Workflow run (ADR 0003). Keeping its id
-- lets the run page reconnect to the workflow's progress stream after a reload.

alter table document_compliance.prescreen_runs
  add column workflow_run_id text;
