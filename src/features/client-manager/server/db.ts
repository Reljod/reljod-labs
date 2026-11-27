import "server-only";
import postgres from "postgres";
import { dbStats } from "@/server/postgres";
import { env } from "./env";

let client: postgres.Sql | undefined;

/**
 * One small pool per function instance, set up for Supabase's transaction
 * pooler (Supavisor): prepared statements off, and one query per connection
 * at a time. postgres.js pipelines up to 100 queries on one connection by
 * default, and Supavisor stalls on that: a page that ran three queries at
 * once hung with Postgres waiting for the rest of the second one.
 *
 * Its own pool, not the shared `db()`: Client Manager's rows keep
 * `timestamptz` as `Date`s (Builds' ages, the purge, the views'
 * `toISOString()`), where `createPool` parses them to ISO strings.
 */
export function sql() {
  client ??= postgres(env.databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    debug: dbStats.enabled ? dbStats.count : undefined,
    // Node and Edge ids are identity columns; they fit a JS number for good.
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
