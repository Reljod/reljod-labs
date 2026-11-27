import "server-only";
import postgres from "postgres";
import { databaseUrl, dbStats } from "@/server/postgres";

let client: postgres.Sql | undefined;

/**
 * Harness's own pool, built once per function instance: its rows read
 * `timestamptz` and `timestamp` columns as `Date`s (`created_at.toISOString()`
 * everywhere), not the ISO strings the shared `db()` pool parses them into,
 * so it cannot share that pool. Otherwise set up the same way for Supabase's
 * transaction pooler (Supavisor): prepared statements off, one query per
 * connection at a time, and counted under `DB_STATS=1`.
 */
export function sql() {
  client ??= postgres(databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    debug: dbStats.enabled ? dbStats.count : undefined,
    // Passage and Audit event ids are identity columns; they fit a JS number for good.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => Number(value),
      },
    },
    transform: { undefined: null },
  });
  return client;
}

/** The pool, or a transaction on it: what a function takes when it may run inside either. */
export type Db = postgres.Sql | postgres.TransactionSql;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check an id from a URL or a cookie before it reaches a `uuid` column. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A value for a `jsonb` column. */
export function jsonb(db: Db, value: unknown) {
  return db.json(value as never);
}
