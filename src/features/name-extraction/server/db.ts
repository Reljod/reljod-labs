import "server-only";
import { createPool, type Pool } from "@/server/postgres";

let client: Pool | undefined;

/**
 * One small pool per function instance on `DATABASE_URL` (the shared,
 * Supavisor-safe pool from `@/server/postgres`), made on first use so the
 * eval script and `next build` never need the variable.
 */
export function sql() {
  client ??= createPool();
  return client;
}
