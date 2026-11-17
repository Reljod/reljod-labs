import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/** Private bucket for Uploads: `uploads/<owner hash>/<upload id>.json`, `{ pages: string[] }`. */
export const BUCKET = "name-extraction";

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    db: { schema: "name_extraction" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client: server code only, bypasses RLS on the `name_extraction` schema. */
export function supabase() {
  client ??= createServiceClient();
  return client;
}
