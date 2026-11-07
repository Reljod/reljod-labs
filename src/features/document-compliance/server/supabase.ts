import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const BUCKET = "document-compliance";

let client: ReturnType<typeof createServiceClient> | undefined;

/**
 * Untyped on purpose: supabase-js's schema generics only accept generated types,
 * which cover `public` alone. The repository types every row it reads with
 * `database.types.ts` instead.
 */
function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    db: { schema: "document_compliance" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client: server code only, bypasses RLS on the `document_compliance` schema. */
export function supabase() {
  client ??= createServiceClient();
  return client;
}

export async function signedUrl(path: string, expiresInSeconds = 600) {
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`Could not sign ${path}: ${error.message}`);
  return data.signedUrl;
}

export async function signedUrls(paths: string[], expiresInSeconds = 3600) {
  if (paths.length === 0) return new Map<string, string>();
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error) throw new Error(`Could not sign page images: ${error.message}`);
  return new Map(
    data.flatMap((item) =>
      item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [],
    ),
  );
}
