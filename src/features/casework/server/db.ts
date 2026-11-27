import "server-only";
import { createPool, type Pool } from "@/server/postgres";

let client: Pool | undefined;

/**
 * The `casework` schema, reached directly over `DATABASE_URL` (the shared
 * Supavisor-safe pool). Created on first use so `next build` needs no secrets.
 */
export function sql() {
  client ??= createPool();
  return client;
}
