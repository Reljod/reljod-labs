import "server-only";
import postgres from "postgres";
import { databaseUrl, dbStats } from "@/server/postgres";

let client: postgres.Sql | undefined;

/**
 * The Operator's own pool, built once per function instance. Its rows keep
 * `timestamptz` as a `Date` (the shared pool, `db()`, gives ISO strings), so
 * it is not the shared one; otherwise it is set up as that one is, for
 * Supabase's transaction pooler (Supavisor): prepared statements off, one
 * query per connection at a time, and counted for the benchmark.
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
    // Event seqs are identity columns; they fit a JS number for good.
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

/** The pool, or a transaction on it. */
export type Db = postgres.Sql | postgres.TransactionSql;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check an id from a URL, a tool call or a cookie before it reaches a `uuid` column. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A value for a `jsonb` column. */
export function jsonb(db: Db, value: unknown) {
  return db.json(value as never);
}
