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

/**
 * What Storage really holds at a path: its size and its first bytes, or null
 * when there is no object. Reads only the head, by a ranged request, so a
 * check never downloads the whole file.
 */
export async function storedObject(
  path: string,
  headBytes: number,
): Promise<{ size: number; head: Uint8Array } | null> {
  const bucket = supabase().storage.from(BUCKET);
  const { data: info, error } = await bucket.info(path);
  if (error || !info) return null;
  const size = (info as { size?: unknown }).size;
  if (typeof size !== "number") return null;
  const { data: signed, error: signError } = await bucket.createSignedUrl(
    path,
    60,
  );
  if (signError || !signed) return null;
  const response = await fetch(signed.signedUrl, {
    headers: { range: `bytes=0-${headBytes - 1}` },
  });
  if (!response.ok || !response.body) return { size, head: new Uint8Array() };
  // A server that ignores the range sends the whole file: stop reading early.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  while (read < headBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    read += value.length;
  }
  await reader.cancel().catch(() => {});
  const head = new Uint8Array(Math.min(read, headBytes));
  let at = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, head.length - at);
    head.set(part, at);
    at += part.length;
    if (at >= head.length) break;
  }
  return { size, head };
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
