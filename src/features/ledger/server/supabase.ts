import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    db: { schema: "ledger" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client: server code only, bypasses RLS on the `ledger` schema. */
export function supabase() {
  client ??= createServiceClient();
  return client;
}
