import "server-only";
import { db } from "@/server/postgres";

/**
 * The `access` schema is reached directly on the shared pool of this
 * function instance (`db()`), not through the Data API. The proxy runs on
 * the Node.js runtime, so it uses the same pool.
 */
export const sql = db;

/** Postgres's codes for a table or a function that is not there yet. */
export const UNDEFINED_TABLE = "42P01";
export const UNDEFINED_FUNCTION = "42883";

/** The Postgres error code of a failed query, if it has one. */
export function pgCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
