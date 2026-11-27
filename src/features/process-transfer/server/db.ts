import "server-only";
import postgres from "postgres";
import { databaseUrl, dbStats } from "@/server/postgres";

let client: postgres.Sql | undefined;

/**
 * Handover's own pool, built once per function instance. It is not the
 * shared `db()` because its rows rely on postgres.js's default parsers:
 * `timestamptz` comes back as a `Date` (`started_at.getTime()`, the stale-Run
 * sweep), where the shared pool gives ISO strings. Set up for Supabase's
 * transaction pooler like the shared one: prepared statements off and one
 * query per connection at a time (Supavisor stalls on pipelined queries).
 */
export function sql() {
  client ??= postgres(databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    debug: dbStats.enabled ? dbStats.count : undefined,
    // Audit ids are identity columns; they fit a JS number for good.
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
