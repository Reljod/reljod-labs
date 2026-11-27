import "server-only";
import { databaseUrl, dbStats } from "@/server/postgres";
import { makePool, type Pool } from "../core/db";

let pool: Pool | undefined;

/**
 * The bank's own pool, built once per function instance. It is not the
 * shared `db()`: the bank's rows come back camelCased with its own type
 * parsers (see core/db.ts). Its statements count toward `DB_STATS=1`.
 */
export function sql(): Pool {
  pool ??= makePool(databaseUrl(), 4, {
    debug: dbStats.enabled ? dbStats.count : undefined,
  });
  return pool;
}
