#!/usr/bin/env bash
# Applies the bank migration to a throwaway Postgres in Docker and runs the
# ledger's integration tests against it (src/features/bank/core/bank.db.test.ts):
# balanced entries, an immutable ledger, idempotent commands, no overdraft
# under concurrent transfers, maker-checker, clearing and end-of-day.
# Usage: pnpm test:bank-db
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
name="bank-ledger-test-$$"
port="${BANK_TEST_PORT:-54331}"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test -p "127.0.0.1:$port:5432" postgres:17-alpine >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1

psql() { docker exec -i "$name" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"; }

psql <<'SQL'
create role anon; create role authenticated; create role service_role;
create schema access;
SQL
# The Owner registry and purge, exactly as the access migration defines them.
sed -n '/^create table access.owned_tables/,/^\$\$;/p' \
  "$root/supabase/migrations/20261115120000_access_owners.sql" | psql
psql < "$root/supabase/migrations/20261119120000_bank.sql"

cd "$root"
BANK_TEST_DATABASE_URL="postgres://postgres:test@127.0.0.1:$port/postgres" \
  pnpm exec vitest run src/features/bank/core/bank.db.test.ts
