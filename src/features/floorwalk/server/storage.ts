import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, LIMITS } from "../domain/limits";
import { env } from "./env";

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

/** A one-time URL the browser PUTs footage to, so the video never passes through a function body. */
export async function uploadUrl(path: string) {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error) throw new Error(`Could not prepare upload: ${error.message}`);
  return data.signedUrl;
}

export async function download(path: string): Promise<Uint8Array | null> {
  const { data, error } = await bucket().download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Uploads are kept only while they are being walked and asked about: each
 * new upload deletes the same folder's files older than `LIMITS.uploadHours`.
 * Best effort; a failure here never blocks an upload.
 */
export async function pruneFolder(folder: string) {
  try {
    const { data } = await bucket().list(folder, { limit: 100 });
    const cutoff = Date.now() - LIMITS.uploadHours * 3600 * 1000;
    const old = (data ?? [])
      .filter(
        (file) =>
          file.created_at && new Date(file.created_at).getTime() < cutoff,
      )
      .map((file) => `${folder}/${file.name}`);
    if (old.length) await bucket().remove(old);
  } catch (error) {
    console.error("[floorwalk] prune", error);
  }
}
