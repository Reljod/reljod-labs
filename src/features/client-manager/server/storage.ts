import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const BUCKET = "client-manager";

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

/** A one-time URL the browser PUTs a file to, so uploads skip the function body limit. */
export async function uploadUrl(path: string) {
  const { data, error } = await bucket().createSignedUploadUrl(path, {
    upsert: true,
  });
  if (error) throw new Error(`Could not prepare upload: ${error.message}`);
  return data.signedUrl;
}

export async function upload(
  path: string,
  data: Uint8Array,
  contentType: string,
) {
  const { error } = await bucket().upload(path, data, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Could not store ${path}: ${error.message}`);
}

export async function download(path: string) {
  const { data, error } = await bucket().download(path);
  if (error || !data) {
    throw new Error(`Could not read ${path}: ${error?.message ?? "missing"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

export async function signedUrls(paths: string[], expiresInSeconds = 3600) {
  const wanted = [...new Set(paths.filter(Boolean))];
  if (wanted.length === 0) return new Map<string, string>();
  const { data, error } = await bucket().createSignedUrls(
    wanted,
    expiresInSeconds,
  );
  if (error) return new Map<string, string>();
  return new Map(
    data.flatMap((item) =>
      item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : [],
    ),
  );
}

export async function signedUrl(path: string, expiresInSeconds = 3600) {
  return (await signedUrls([path], expiresInSeconds)).get(path) ?? null;
}

/** Every object under a folder, depth first; Storage lists one level at a time. */
async function listAll(prefix: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const { data, error } = await bucket().list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const paths: string[] = [];
  for (const item of data) {
    const path = `${prefix}/${item.name}`;
    // Folders come back without an id.
    if (item.id) paths.push(path);
    else paths.push(...(await listAll(path, depth + 1)));
  }
  return paths;
}

export async function removeFolder(prefix: string) {
  const paths = await listAll(prefix);
  for (let index = 0; index < paths.length; index += 100) {
    await bucket().remove(paths.slice(index, index + 100));
  }
  return paths.length;
}
