import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, env } from "./env";

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const bucket = () => {
  client ??= createServiceClient();
  return client.storage.from(BUCKET);
};

/** A one-time URL the browser PUTs a recording to; the audio never passes through a function. */
export async function uploadUrl(path: string) {
  const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(`Could not prepare the upload: ${error.message}`);
  return data.signedUrl;
}

/** The stored object's size in bytes, or null when there is none. */
export async function objectSize(path: string): Promise<number | null> {
  const { data, error } = await bucket().info(path);
  if (error || !data) return null;
  const size = (data as { size?: unknown }).size;
  return typeof size === "number" ? size : null;
}

/** A URL the Owner can play a private recording from, for ten minutes. */
export async function playUrl(path: string) {
  const { data, error } = await bucket().createSignedUrl(path, 600);
  return error || !data ? null : data.signedUrl;
}
