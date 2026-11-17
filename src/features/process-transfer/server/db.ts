import "server-only";
import postgres from "postgres";
import { env } from "./env";

let client: postgres.Sql | undefined;

/**
 * One small pool per function instance, set up for Supabase's transaction
 * pooler like Client Manager's: prepared statements off and one query per
 * connection at a time (Supavisor stalls on pipelined queries).
 */
export function sql() {
  client ??= postgres(env.databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
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
