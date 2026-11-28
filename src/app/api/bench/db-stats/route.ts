import { connection } from "next/server";
import { dbStats } from "@/server/postgres";

/**
 * The process's running count of SQL statements, for `scripts/bench-api.mts`.
 * Answers only on a server started with `DB_STATS=1` (never set on Vercel);
 * everywhere else it is a 404, so it tells a visitor nothing.
 */
export async function GET() {
  await connection();
  if (!dbStats.enabled) return new Response("Not found", { status: 404 });
  return Response.json(
    { statements: dbStats.snapshot() },
    { headers: { "cache-control": "no-store" } },
  );
}
