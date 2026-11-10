import "server-only";
import postgres from "postgres";
import { env } from "./env";

let client: postgres.Sql | undefined;

/**
 * One small pool per function instance. Prepared statements are off so the
 * same code works through Supabase's transaction pooler.
 */
export function sql() {
  client ??= postgres(env.databaseUrl(), {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
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
