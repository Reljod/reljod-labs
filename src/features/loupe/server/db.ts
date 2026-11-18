import "server-only";
import postgres from "postgres";
import { env } from "./env";

let client: postgres.Sql | undefined;

/**
 * One small pool per function instance, set up for Supabase's transaction
 * pooler (Supavisor) exactly as the Harness's is: prepared statements off,
 * and one query per connection at a time.
 */
export function sql() {
  client ??= postgres(env.databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    // Event and audit ids are identity columns; they fit a JS number for good.
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

/** Check an id from a URL, a tool call or a token before it reaches a `uuid` column. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A value for a `jsonb` column. */
export function jsonb(db: Db, value: unknown) {
  return db.json(value as never);
}
