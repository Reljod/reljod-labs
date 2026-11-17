import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, env } from "../env";

/**
 * The private `harness` bucket (created by the Harness migration), reached
 * with the service role key and only from the server. A Source's file lives at
 * `owners/<owner>/sources/<sourceId>/<slug>.<ext>`; see `sourceStorageKey`.
 */

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bucket() {
  client ??= createServiceClient();
  return client.storage.from(BUCKET);
}

/** A one-time URL the browser PUTs a file to, so an upload skips the function body limit. */
export async function uploadUrl(path: string): Promise<string> {
  const { data, error } = await bucket().createSignedUploadUrl(path, {
    upsert: true,
  });
  if (error) throw new Error(`Could not prepare upload: ${error.message}`);
  return data.signedUrl;
}

export async function download(path: string): Promise<Uint8Array> {
  const { data, error } = await bucket().download(path);
  if (error || !data) {
    throw new Error(`Could not read the file: ${error?.message ?? "missing"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** Best effort: a file that is already gone is not an error. */
export async function removeFile(path: string): Promise<void> {
  try {
    await bucket().remove([path]);
  } catch (error) {
    console.error("[harness] could not remove a Source's file", error);
  }
}
