import "server-only";
import { createPool, type Pool } from "@/server/postgres";

let client: Pool | undefined;

/**
 * One small pool per function instance, on the shared `DATABASE_URL`: the
 * `access` schema is reached directly, not through the Data API. The proxy
 * runs on the Node.js runtime, so it uses this pool too.
 */
export function sql() {
  client ??= createPool();
  return client;
}

/** Postgres's codes for a table or a function that is not there yet. */
export const UNDEFINED_TABLE = "42P01";
export const UNDEFINED_FUNCTION = "42883";

/** The Postgres error code of a failed query, if it has one. */
export function pgCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
