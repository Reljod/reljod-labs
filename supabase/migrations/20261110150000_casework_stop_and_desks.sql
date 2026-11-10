-- Casework: a Run can be stopped by the person, and a browser can go back to
-- earlier desks, so each Session carries a title and when it was last used.

alter table casework.runs drop constraint runs_status_check;
alter table casework.runs add constraint runs_status_check check (
  status in ('queued', 'running', 'waiting', 'completed', 'failed', 'stopped')
);

alter table casework.job_runs drop constraint job_runs_status_check;
alter table casework.job_runs add constraint job_runs_status_check check (
  status in ('running', 'waiting', 'done', 'skipped', 'failed', 'stopped')
);

alter table casework.sessions
  -- The first thing the person asked for, shown in the list of earlier desks.
  add column title text,
  add column last_active_at timestamptz not null default now();
