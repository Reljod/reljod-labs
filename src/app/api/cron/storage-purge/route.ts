import { cronAuthorized } from "@/features/access/server/cron";
import { env } from "@/features/access/server/env";
import {
  drainStoragePurge,
  storagePurgeDeps,
} from "@/features/access/server/storage-purge";

/**
 * Vercel Cron (vercel.json `crons`), daily after the Guest pass purge: removes
 * the Storage files of purged Owners, queued in `access.storage_purge` by
 * `access.purge_owner`. Not behind the proxy (no demo path): it checks
 * `Authorization: Bearer <CRON_SECRET>` itself, and refuses everyone while
 * CRON_SECRET is unset. Bounded per run; what is left waits for the next one.
 */
export const maxDuration = 120;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), env.cronSecret())) {
    return new Response("Not found", { status: 404, headers: NO_STORE });
  }
  try {
    const result = await drainStoragePurge(storagePurgeDeps);
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    console.error("[access] storage purge failed", error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
