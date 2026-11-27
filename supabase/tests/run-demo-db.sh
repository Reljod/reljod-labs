#!/usr/bin/env bash
# Applies the Document compliance, Ledger, Casework and Sieve migrations to a
# throwaway Postgres in Docker, on top of stubs for what Supabase provides
# (roles, auth, storage, pg_cron), and runs each demo's repository against it
# (`*.db.test.ts`, skipped unless DEMO_TEST_DATABASE_URL is set).
# Usage: supabase/tests/run-demo-db.sh [vitest args]
# Keep the container for another run: KEEP=1 (it prints the URL).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
name="demo-db-test-$$"
port="${PORT:-$((20000 + RANDOM % 20000))}"
docker run -d --rm --name "$name" -p "127.0.0.1:$port:5432" \
  -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
if [ -z "${KEEP:-}" ]; then trap 'docker stop "$name" >/dev/null' EXIT; fi
until docker exec "$name" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done

psql() { docker exec -i "$name" psql -U postgres -q -1 -v ON_ERROR_STOP=1 "$@" >/dev/null; }

psql <<'SQL'
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key, is_anonymous boolean, created_at timestamptz default now());
create function auth.uid() returns uuid language sql as 'select null::uuid';
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create schema cron;
create table cron.job (jobname text);
create function cron.schedule(a text, b text, c text) returns bigint language sql as 'select 1::bigint';
create function cron.unschedule(a text) returns boolean language sql as 'select true';
SQL

for migration in \
  20261107120000_document_compliance \
  20261107150000_prescreen_workflow_run \
  20261107180000_in_app_parsers \
  20261108120000_ledger \
  20261110120000_casework \
  20261110120000_run_metrics_and_sessions \
  20261110150000_casework_stop_and_desks \
  20261110180000_access \
  20261115120000_access_owners \
  20261115120100_casework_owners \
  20261115120300_document_compliance_and_ledger_owners \
  20261117170000_document_compliance_rules_audit \
  20261117200000_name_extraction \
  20261127110000_ledger_rate_hits \
  20261127130000_casework_caps \
  20261127130100_casework_uploads \
  20261127130200_document_compliance_take_run; do
  grep -vi "create extension.*pg_cron" "$root/supabase/migrations/$migration.sql" | psql
done

url="postgres://postgres:test@127.0.0.1:$port/postgres"
if [ -n "${KEEP:-}" ]; then echo "DEMO_TEST_DATABASE_URL=$url (container $name)"; fi
cd "$root"
DEMO_TEST_DATABASE_URL="$url" pnpm exec vitest run \
  src/features/document-compliance src/features/ledger \
  src/features/casework src/features/name-extraction "$@"
