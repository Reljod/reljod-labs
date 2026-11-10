import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const BUCKET = "casework";

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    db: { schema: "casework" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client: server code only, bypasses RLS on the `casework` schema. */
export function supabase() {
  client ??= createServiceClient();
  return client;
}

export async function download(path: string) {
  const { data, error } = await supabase().storage.from(BUCKET).download(path);
  if (error) throw new Error(`Could not download ${path}: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function signedUrls(paths: string[], expiresInSeconds = 3600) {
  if (paths.length === 0) return new Map<string, string>();
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error) throw new Error(`Could not sign files: ${error.message}`);
  return new Map(
    data.flatMap((item) =>
      item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [],
    ),
  );
}
