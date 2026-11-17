import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BUCKET } from "../domain/limits";
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

/**
 * A one-time URL the browser PUTs a Recording to, so the video never passes
 * through a function body. No upsert: a path is used once.
 */
export async function uploadUrl(path: string) {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error) throw new Error(`Could not prepare upload: ${error.message}`);
  return data.signedUrl;
}

/** The stored object's size in bytes, or null when there is none. */
export async function objectSize(path: string): Promise<number | null> {
  const { data, error } = await bucket().info(path);
  if (error || !data) return null;
  const size = (data as { size?: unknown }).size;
  return typeof size === "number" ? size : null;
}

export async function download(path: string) {
  const { data, error } = await bucket().download(path);
  if (error || !data) {
    throw new Error(
      `Could not read the Recording: ${error?.message ?? "missing"}`,
    );
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** A URL the browser can play a private Recording from, for about an hour. */
export async function signedUrl(path: string, expiresInSeconds = 3600) {
  const { data, error } = await bucket().createSignedUrl(
    path,
    expiresInSeconds,
  );
  return error || !data ? null : data.signedUrl;
}

/** Objects stored under a folder since a time; for the daily upload cap. */
export async function uploadsSince(prefix: string, since: Date) {
  const { data, error } = await bucket().list(prefix, {
    limit: 1000,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw new Error(`Could not count uploads: ${error.message}`);
  return (data ?? []).filter(
    (item) => item.id && item.created_at && new Date(item.created_at) >= since,
  ).length;
}
