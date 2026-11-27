import "server-only";
import { createClient } from "@supabase/supabase-js";
import { extractText } from "@/features/harness/server/knowledge/extract";
import { BUCKET, env } from "./env";
import type { FrameStore, ManifestFiles } from "./ports";

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The private `operator` bucket, through the service role. Storage only: rows go through `sql()`. */
export function bucket() {
  client ??= createServiceClient();
  return client.storage.from(BUCKET);
}

/** Where a Frame's picture is kept. The run id is a uuid the server made; `n` a number. */
export const framePath = (runId: string, n: number) =>
  `frames/${runId}/${Math.trunc(n)}.png`;

/**
 * The last few Frames this instance stored, so the one that was just taken
 * is not downloaded again to show it to the driver.
 */
const recent = new Map<string, Buffer>();
const RECENT = 12;

function remember(path: string, png: Buffer) {
  recent.delete(path);
  recent.set(path, png);
  while (recent.size > RECENT) {
    const oldest = recent.keys().next().value;
    if (oldest === undefined) break;
    recent.delete(oldest);
  }
}

export async function putFrame(runId: string, n: number, png: Buffer) {
  const { error } = await bucket().upload(framePath(runId, n), png, {
    contentType: "image/png",
    upsert: true,
  });
  if (error)
    throw new Error(`Frame ${n} could not be stored: ${error.message}`);
  remember(framePath(runId, n), png);
}

export async function getFrame(runId: string, n: number) {
  const kept = recent.get(framePath(runId, n));
  if (kept) return kept;
  const { data, error } = await bucket().download(framePath(runId, n));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Frames in the private bucket, at `frames/<run id>/<n>.png`. */
export const frameStore: FrameStore = { put: putFrame, get: getFrame };

/** Manifest files in the private bucket, at `manifests/<hashed owner>/<id>.<ext>`. */
export const manifestFiles: ManifestFiles = {
  async uploadUrl(path) {
    const { data, error } = await bucket().createSignedUploadUrl(path, {
      upsert: false,
    });
    return error || !data
      ? null
      : { signedUrl: data.signedUrl, token: data.token };
  },
  async download(path) {
    const { data, error } = await bucket().download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  },
  pdfText: (bytes) => extractText("pdf", bytes),
};
