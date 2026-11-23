import "server-only";
import postgres from "postgres";
import { env } from "./env";

let client: postgres.Sql | undefined;

/**
 * One small pool per function instance, configured for Supabase's transaction
 * pooler (Supavisor): prepared statements off and one query per connection.
 */
export function sql() {
  client ??= postgres(env.databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max: 4,
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
    },
    transform: { undefined: null },
  });
  return client;
}
