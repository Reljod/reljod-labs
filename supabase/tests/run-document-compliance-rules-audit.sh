#!/usr/bin/env bash
# Applies the Rules and Audit trail migration to a throwaway Postgres in
# Docker, on top of stubs for what it builds on, and runs its checks.
# Usage: supabase/tests/run-document-compliance-rules-audit.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
name="dc-rules-audit-test-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

psql() { docker exec -i "$name" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"; }

psql <<'SQL'
create role anon; create role authenticated; create role service_role;
create schema access;
create schema document_compliance;
-- Only the columns the migration's functions read.
create table document_compliance.prescreen_runs (
  id uuid primary key default gen_random_uuid(),
  owner text,
  status text not null default 'queued'
);
SQL
# The Owner registry and purge, exactly as the access migration defines them.
sed -n '/^create table access.owned_tables/,/^\$\$;/p' \
  "$root/supabase/migrations/20261115120000_access_owners.sql" | psql
psql < "$root/supabase/migrations/20261117170000_document_compliance_rules_audit.sql"
psql < "$root/supabase/tests/document_compliance_rules_audit.test.sql"
