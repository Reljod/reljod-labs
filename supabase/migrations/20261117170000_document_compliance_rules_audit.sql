-- Document compliance: Rules an Owner edits, re-evaluations, Reviewer
-- decisions and an append-only Audit trail (ADR 0019).
-- Language: src/features/document-compliance/GLOSSARY.md.
--
-- Additive only: the code already deployed reads none of this and keeps
-- working. Accessed only from server code with the service role.

-- The Rules a run applied ----------------------------------------------------

-- Every Rule's Version, switch and Parameters as the run applied them. Null on
-- runs from before Rules were edited: those applied the Defaults.
alter table document_compliance.prescreen_runs
  add column if not exists rules_applied jsonb;

-- Rule Versions --------------------------------------------------------------

-- One row per saved state of one Rule for one Owner; the highest Version is in
-- force. Version 0 is the Default in code and is never stored.
create table document_compliance.rule_versions (
  id bigint generated always as identity primary key,
  owner text not null check (char_length(owner) between 1 and 80),
  rule_id text not null check (char_length(rule_id) between 1 and 64),
  version integer not null check (version > 0),
  enabled boolean not null,
  params jsonb not null default '{}'::jsonb,
  -- The Version this one copies, for a restore.
  restored_from integer check (restored_from >= 0),
  saved_by text not null check (char_length(saved_by) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (owner, rule_id, version)
);

create index rule_versions_owner_created_at_idx
  on document_compliance.rule_versions (owner, created_at desc);

-- Re-evaluations -------------------------------------------------------------

-- A run's Rulebook evaluated again over its stored readings. Evaluation 1 is
-- the run's own (the `findings` table); these are 2, 3, … and hold their
-- Findings whole, with Evidence as Document kind, field name and span refs.
create table document_compliance.evaluations (
  id bigint generated always as identity primary key,
  run_id uuid not null references document_compliance.prescreen_runs (id) on delete cascade,
  number integer not null check (number > 1),
  rules_applied jsonb not null,
  findings jsonb not null,
  created_by text not null check (char_length(created_by) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (run_id, number)
);

-- Reviewer decisions ---------------------------------------------------------

-- A Reviewer settling a flagged Finding as Pass or Fail, with a note. Only
-- added to: the newest decision on a Requirement is the one that stands.
create table document_compliance.finding_reviews (
  id bigint generated always as identity primary key,
  run_id uuid not null references document_compliance.prescreen_runs (id) on delete cascade,
  evaluation integer not null check (evaluation > 0),
  requirement_id text not null check (char_length(requirement_id) between 1 and 64),
  finding_outcome text not null check (finding_outcome in ('pass', 'fail', 'needs_review')),
  outcome text not null check (outcome in ('pass', 'fail')),
  note text not null check (char_length(note) between 3 and 1000),
  reviewer text not null check (char_length(reviewer) between 1 and 120),
  created_at timestamptz not null default now()
);

create index finding_reviews_run_id_idx
  on document_compliance.finding_reviews (run_id, id);

-- Audit trail ----------------------------------------------------------------

-- One row per Owner who has an Audit trail. It is the only Audit table in
-- `access.owned_tables`: purging an Owner deletes this row, and the foreign
-- key below takes the events with it.
create table document_compliance.audit_trails (
  owner text primary key check (char_length(owner) between 1 and 80),
  created_at timestamptz not null default now()
);

create table document_compliance.audit_events (
  id bigint generated always as identity primary key,
  owner text not null references document_compliance.audit_trails (owner) on delete cascade,
  -- No foreign key: an event outlives its run, which expires after 30 days.
  run_id uuid,
  actor_kind text not null check (actor_kind in ('person', 'model', 'system')),
  actor_label text not null check (char_length(actor_label) between 1 and 120),
  action text not null check (action in (
    'run.started',
    'document.read',
    'run.finished',
    'run.failed',
    'rule.saved',
    'rule.restored',
    'run.reevaluated',
    'finding.reviewed'
  )),
  summary text not null check (char_length(summary) between 1 and 500),
  -- Ids, names, counts and Rule Versions; never a document or a secret.
  details jsonb not null default '{}'::jsonb,
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index audit_events_owner_id_idx
  on document_compliance.audit_events (owner, id desc);
create index audit_events_owner_run_idx
  on document_compliance.audit_events (owner, run_id, id desc)
  where run_id is not null;

-- Events are only ever added. UPDATE and TRUNCATE are always refused. DELETE
-- is refused while the event's trail exists, which is what lets the Owner
-- purge through: `access.purge_owner` deletes the trail row, the foreign key
-- cascades to the events, and by then the trail is gone so the trigger lets
-- them go. Any other DELETE finds the trail and fails. Do NOT register
-- `audit_events` itself in `access.owned_tables`: a direct delete there would
-- raise and abort the whole purge.
create function document_compliance.audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from document_compliance.audit_trails t where t.owner = old.owner
    ) then
      return old;
    end if;
    raise exception 'document_compliance.audit_events is append-only: an Audit event goes only with its trail'
      using errcode = 'integrity_constraint_violation';
  end if;
  raise exception 'document_compliance.audit_events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger audit_events_no_update
  before update on document_compliance.audit_events
  for each row execute function document_compliance.audit_events_append_only();

create trigger audit_events_no_delete
  before delete on document_compliance.audit_events
  for each row execute function document_compliance.audit_events_append_only();

create trigger audit_events_no_truncate
  before truncate on document_compliance.audit_events
  for each statement execute function document_compliance.audit_events_append_only();

-- Writing: one function per write, so a row and its event land together ------

-- Appends one Audit event, opening the Owner's trail on first use.
create function document_compliance.append_audit_event(
  p_owner text,
  p_run_id uuid,
  p_actor_kind text,
  p_actor_label text,
  p_action text,
  p_summary text,
  p_details jsonb default '{}'::jsonb,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_cost_usd numeric default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  event_id bigint;
begin
  insert into document_compliance.audit_trails (owner)
  values (p_owner)
  on conflict (owner) do nothing;

  insert into document_compliance.audit_events (
    owner, run_id, actor_kind, actor_label, action, summary, details,
    model, input_tokens, output_tokens, cost_usd
  )
  values (
    p_owner, p_run_id, p_actor_kind, left(p_actor_label, 120), p_action,
    left(p_summary, 500), coalesce(p_details, '{}'::jsonb),
    p_model, p_input_tokens, p_output_tokens, p_cost_usd
  )
  returning id into event_id;
  return event_id;
end;
$$;

-- Saves a Rule's next Version and its `rule.saved` / `rule.restored` event in
-- one transaction. Returns the new Version. Refuses past `p_max_per_hour`
-- saves by this Owner in the last hour.
create function document_compliance.save_rule_version(
  p_owner text,
  p_rule_id text,
  p_enabled boolean,
  p_params jsonb,
  p_restored_from integer,
  p_saved_by text,
  p_summary text,
  p_details jsonb,
  p_max_per_hour integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
begin
  -- One writer per Owner and Rule at a time, so Versions never collide.
  perform pg_advisory_xact_lock(hashtext('document_compliance.rule:' || p_owner || ':' || p_rule_id));

  if (
    select count(*) from document_compliance.rule_versions rv
    where rv.owner = p_owner and rv.created_at > now() - interval '1 hour'
  ) >= p_max_per_hour then
    raise exception 'limit_reached' using errcode = 'P0001';
  end if;

  select coalesce(max(rv.version), 0) + 1 into next_version
  from document_compliance.rule_versions rv
  where rv.owner = p_owner and rv.rule_id = p_rule_id;

  insert into document_compliance.rule_versions (
    owner, rule_id, version, enabled, params, restored_from, saved_by
  )
  values (
    p_owner, p_rule_id, next_version, p_enabled, p_params, p_restored_from,
    left(p_saved_by, 120)
  );

  perform document_compliance.append_audit_event(
    p_owner, null, 'person', p_saved_by,
    case when p_restored_from is null then 'rule.saved' else 'rule.restored' end,
    p_summary,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('ruleId', p_rule_id, 'version', next_version)
  );
  return next_version;
end;
$$;

-- Stores a re-evaluation of an Owner's run and its `run.reevaluated` event in
-- one transaction. Returns the Evaluation's number.
create function document_compliance.record_evaluation(
  p_owner text,
  p_run_id uuid,
  p_rules_applied jsonb,
  p_findings jsonb,
  p_created_by text,
  p_summary text,
  p_details jsonb,
  p_max integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_number integer;
begin
  -- Locks the run, so two re-evaluations at once take turns.
  perform 1 from document_compliance.prescreen_runs r
  where r.id = p_run_id and r.owner = p_owner and r.status = 'completed'
  for update;
  if not found then
    raise exception 'run_not_found' using errcode = 'P0001';
  end if;

  select coalesce(max(e.number), 1) + 1 into next_number
  from document_compliance.evaluations e
  where e.run_id = p_run_id;
  if next_number - 1 > p_max then
    raise exception 'limit_reached' using errcode = 'P0001';
  end if;

  insert into document_compliance.evaluations (
    run_id, number, rules_applied, findings, created_by
  )
  values (p_run_id, next_number, p_rules_applied, p_findings, left(p_created_by, 120));

  perform document_compliance.append_audit_event(
    p_owner, p_run_id, 'person', p_created_by, 'run.reevaluated', p_summary,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('evaluation', next_number)
  );
  return next_number;
end;
$$;

-- Stores a Reviewer decision on an Owner's run and its `finding.reviewed`
-- event in one transaction.
create function document_compliance.record_review(
  p_owner text,
  p_run_id uuid,
  p_evaluation integer,
  p_requirement_id text,
  p_finding_outcome text,
  p_outcome text,
  p_note text,
  p_reviewer text,
  p_summary text,
  p_details jsonb,
  p_max integer
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  review_id bigint;
begin
  perform 1 from document_compliance.prescreen_runs r
  where r.id = p_run_id and r.owner = p_owner and r.status = 'completed'
  for update;
  if not found then
    raise exception 'run_not_found' using errcode = 'P0001';
  end if;

  -- A re-evaluation that landed after the Reviewer looked makes the decision stale.
  if p_evaluation <> (
    select coalesce(max(e.number), 1) from document_compliance.evaluations e
    where e.run_id = p_run_id
  ) then
    raise exception 'stale_evaluation' using errcode = 'P0001';
  end if;

  if (
    select count(*) from document_compliance.finding_reviews fr
    where fr.run_id = p_run_id
  ) >= p_max then
    raise exception 'limit_reached' using errcode = 'P0001';
  end if;

  insert into document_compliance.finding_reviews (
    run_id, evaluation, requirement_id, finding_outcome, outcome, note, reviewer
  )
  values (
    p_run_id, p_evaluation, p_requirement_id, p_finding_outcome, p_outcome,
    p_note, left(p_reviewer, 120)
  )
  returning id into review_id;

  perform document_compliance.append_audit_event(
    p_owner, p_run_id, 'person', p_reviewer, 'finding.reviewed', p_summary,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('reviewId', review_id)
  );
  return review_id;
end;
$$;

-- Access: service role only ----------------------------------------------------

alter table document_compliance.rule_versions enable row level security;
alter table document_compliance.evaluations enable row level security;
alter table document_compliance.finding_reviews enable row level security;
alter table document_compliance.audit_trails enable row level security;
alter table document_compliance.audit_events enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.

grant all on all tables in schema document_compliance to service_role;
grant all on all sequences in schema document_compliance to service_role;

revoke all on function document_compliance.append_audit_event(text, uuid, text, text, text, text, jsonb, text, integer, integer, numeric) from public, anon, authenticated;
revoke all on function document_compliance.save_rule_version(text, text, boolean, jsonb, integer, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function document_compliance.record_evaluation(text, uuid, jsonb, jsonb, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function document_compliance.record_review(text, uuid, integer, text, text, text, text, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function document_compliance.audit_events_append_only() from public, anon, authenticated;
grant execute on function document_compliance.append_audit_event(text, uuid, text, text, text, text, jsonb, text, integer, integer, numeric) to service_role;
grant execute on function document_compliance.save_rule_version(text, text, boolean, jsonb, integer, text, text, jsonb, integer) to service_role;
grant execute on function document_compliance.record_evaluation(text, uuid, jsonb, jsonb, text, text, jsonb, integer) to service_role;
grant execute on function document_compliance.record_review(text, uuid, integer, text, text, text, text, text, text, jsonb, integer) to service_role;

-- Owners: the purge reaches Rule Versions and the Audit trail -----------------
-- Evaluations and Reviewer decisions go with their run by cascade.

insert into access.owned_tables (table_name)
values
  ('document_compliance.rule_versions'::regclass),
  ('document_compliance.audit_trails'::regclass)
on conflict do nothing;
