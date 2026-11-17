-- Checks the guarantees of 20261117170000_document_compliance_rules_audit.sql.
-- Run with scripts/test-document-compliance-migration.sh (a throwaway
-- Postgres in Docker); every block raises if a guarantee does not hold.

\set ON_ERROR_STOP 1

insert into document_compliance.prescreen_runs (id, owner, status) values
  ('11111111-1111-1111-1111-111111111111', 'guest:a', 'completed'),
  ('22222222-2222-2222-2222-222222222222', 'guest:b', 'completed');

create function pg_temp.expect_error(sql text, expected text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'expected "%" from: %', expected, sql;
exception when others then
  if position(expected in sqlerrm) = 0 then
    raise exception 'expected "%" but got "%" from: %', expected, sqlerrm, sql;
  end if;
end;
$$;

do $$
begin
  -- Rule Versions number themselves, per Owner and Rule.
  assert document_compliance.save_rule_version('guest:a', 'name-matches', true, '{"onMismatch":"fail"}', null, 'G', 's', '{}', 60) = 1;
  assert document_compliance.save_rule_version('guest:a', 'name-matches', true, '{"onMismatch":"needs_review"}', 0, 'G', 's', '{}', 60) = 2;
  assert document_compliance.save_rule_version('guest:b', 'name-matches', true, '{}', null, 'G', 's', '{}', 60) = 1;
  perform pg_temp.expect_error($q$select document_compliance.save_rule_version('guest:a', 'no-tampering', false, '{}', null, 'G', 's', '{}', 2)$q$, 'limit_reached');

  -- Evaluations number from 2, only for the Owner's own finished run, capped.
  assert document_compliance.record_evaluation('guest:a', '11111111-1111-1111-1111-111111111111', '[]', '[]', 'G', 's', '{}', 2) = 2;
  perform pg_temp.expect_error($q$select document_compliance.record_evaluation('guest:a', '22222222-2222-2222-2222-222222222222', '[]', '[]', 'G', 's', '{}', 20)$q$, 'run_not_found');
  assert document_compliance.record_evaluation('guest:a', '11111111-1111-1111-1111-111111111111', '[]', '[]', 'G', 's', '{}', 2) = 3;
  perform pg_temp.expect_error($q$select document_compliance.record_evaluation('guest:a', '11111111-1111-1111-1111-111111111111', '[]', '[]', 'G', 's', '{}', 2)$q$, 'limit_reached');

  -- A decision must be on the latest Evaluation and carry a note.
  perform document_compliance.record_review('guest:a', '11111111-1111-1111-1111-111111111111', 3, 'name-matches', 'needs_review', 'pass', 'Known variant', 'G', 's', '{}', 60);
  perform pg_temp.expect_error($q$select document_compliance.record_review('guest:a', '11111111-1111-1111-1111-111111111111', 2, 'name-matches', 'needs_review', 'pass', 'Known variant', 'G', 's', '{}', 60)$q$, 'stale_evaluation');
  perform pg_temp.expect_error($q$select document_compliance.record_review('guest:a', '11111111-1111-1111-1111-111111111111', 3, 'name-matches', 'needs_review', 'pass', 'ok', 'G', 's', '{}', 60)$q$, 'finding_reviews_note_check');
  perform pg_temp.expect_error($q$select document_compliance.record_review('guest:b', '11111111-1111-1111-1111-111111111111', 3, 'name-matches', 'needs_review', 'pass', 'Known variant', 'G', 's', '{}', 60)$q$, 'run_not_found');

  -- Every write above that landed left exactly one event.
  assert (select count(*) from document_compliance.audit_events where owner = 'guest:a') = 5;

  -- Events are only added.
  perform pg_temp.expect_error($q$update document_compliance.audit_events set summary = 'x'$q$, 'append-only');
  perform pg_temp.expect_error($q$delete from document_compliance.audit_events where owner = 'guest:a'$q$, 'append-only');
  perform pg_temp.expect_error($q$truncate document_compliance.audit_events$q$, 'append-only');

  -- Purging an Owner takes their Rules and events, and nobody else's.
  perform access.purge_owner('guest:a');
  assert (select count(*) from document_compliance.audit_events where owner = 'guest:a') = 0;
  assert (select count(*) from document_compliance.rule_versions where owner = 'guest:a') = 0;
  assert (select count(*) from document_compliance.audit_events where owner = 'guest:b') = 1;
  assert (select count(*) from document_compliance.rule_versions where owner = 'guest:b') = 1;
end;
$$;

select 'document_compliance rules and audit migration: all checks passed' as result;
