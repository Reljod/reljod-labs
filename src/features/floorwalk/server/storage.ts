import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BUCKET } from "../domain/limits";
import { expiredHours } from "../domain/uploads";
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

let lastSweep = 0;

/**
 * Deletes every upload filed under an hour older than `LIMITS.uploadHours`,
 * whoever's it is. Uploads live under `uploads/<hour>/<owner>/`, so expired
 * footage goes in whole hours. Run (after the response) on every page view,
 * Walk, Ask and upload, at most once a minute per instance. Best effort: a
 * failure is logged and blocks nothing.
 */
export async function sweepUploads() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  try {
    const { data: hours } = await bucket().list("uploads", { limit: 1000 });
    for (const hour of expiredHours((hours ?? []).map((h) => h.name)).slice(
      0,
      24,
    )) {
      const { data: owners } = await bucket().list(`uploads/${hour}`, {
        limit: 1000,
      });
      for (const owner of owners ?? []) {
        const folder = `uploads/${hour}/${owner.name}`;
        const { data: files } = await bucket().list(folder, { limit: 1000 });
        const paths = (files ?? []).map((file) => `${folder}/${file.name}`);
        if (paths.length) await bucket().remove(paths);
      }
    }
  } catch (error) {
    console.error("[floorwalk] sweep", error);
  }
}
