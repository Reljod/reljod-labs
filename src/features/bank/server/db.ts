import "server-only";
import { makePool, type Pool } from "../core/db";
import { env } from "./env";

let pool: Pool | undefined;

/** One small pool per function instance (see core/db.ts for how it is set up). */
export function sql(): Pool {
  pool ??= makePool(env.databaseUrl());
  return pool;
}
