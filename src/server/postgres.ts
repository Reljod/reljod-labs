import "server-only";
import postgres from "postgres";

/**
 * The one Supabase Postgres database every demo reaches directly
 * (`DATABASE_URL`, the transaction pooler on port 6543). Read lazily so
 * `next build` works without secrets; the value is never logged.
 */
export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Missing environment variable DATABASE_URL");
  return value;
}

/**
 * A small pool for one function instance, set up for Supabase's transaction
 * pooler (Supavisor): prepared statements off, and one query per connection
 * at a time (postgres.js pipelines by default and Supavisor stalls on that).
 *
 * Values come back in the shape the Data API (PostgREST) gave, so code moved
 * off supabase-js reads the same rows: bigint (identity) columns as numbers,
 * `timestamptz` as an ISO 8601 string with its microseconds and offset
 * (`2026-11-27T10:00:00.123456+00:00`), `timestamp` the same without the
 * offset, and `date` as `YYYY-MM-DD`. `undefined` is sent as null.
 */
export function createPool(max = 4) {
  return postgres(databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => Number(value),
      },
      timestamptz: {
        to: 1184,
        from: [1184],
        serialize: (value: string | Date) =>
          value instanceof Date ? value.toISOString() : value,
        parse: isoTimestamp,
      },
      timestamp: {
        to: 1114,
        from: [1114],
        serialize: (value: string | Date) =>
          value instanceof Date ? value.toISOString() : value,
        parse: isoTimestamp,
      },
      date: {
        to: 1082,
        from: [1082],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
    },
    transform: { undefined: null },
  });
}

/**
 * Postgres prints `2026-11-27 10:00:00.123456+00`; the Data API printed
 * `2026-11-27T10:00:00.123456+00:00`. Exported for its test.
 */
export function isoTimestamp(value: string): string {
  return value
    .replace(" ", "T")
    .replace(/([+-]\d\d)$/, "$1:00")
    .replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
}

export type Pool = ReturnType<typeof createPool>;

/** The pool, or a transaction on it: what a function takes when it may run inside either. */
export type Db =
  | Pool
  | postgres.TransactionSql<Pool extends postgres.Sql<infer T> ? T : never>;

/** A value for a `jsonb` column or argument. */
export function jsonb(db: Db, value: unknown) {
  return db.json(value as never);
}
