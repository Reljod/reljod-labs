import "server-only";
import { createPool, type Pool } from "@/server/postgres";

let client: Pool | undefined;

/**
 * One small pool per function instance, on the shared `DATABASE_URL`: the
 * `document_compliance` schema is reached directly, not through the Data API.
 */
export function sql() {
  client ??= createPool();
  return client;
}
