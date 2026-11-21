import "server-only";
import postgres from "postgres";
import { env } from "./env";

let client: postgres.Sql | undefined;

/**
 * One small pool per function instance, set up for Supabase's transaction
 * pooler like the other demos': prepared statements off, one query per
 * connection at a time. Floorwalk keeps no saved data; only rate hits.
 */
export function sql() {
  client ??= postgres(env.databaseUrl(), {
    prepare: false,
    max_pipeline: 1,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    transform: { undefined: null },
  });
  return client;
}
