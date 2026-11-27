import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/** Private bucket for Uploads: `uploads/<owner hash>/<upload id>.json`, `{ pages: string[] }`. */
export const BUCKET = "name-extraction";

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client for Storage only (the `name-extraction` bucket). The
 * `name_extraction` tables are reached directly through `sql()` in `./db`.
 */
export function supabase() {
  client ??= createServiceClient();
  return client;
}
