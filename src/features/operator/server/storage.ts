import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, env } from "./env";

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

export async function putFrame(runId: string, n: number, png: Buffer) {
  const { error } = await bucket().upload(framePath(runId, n), png, {
    contentType: "image/png",
    upsert: true,
  });
  if (error)
    throw new Error(`Frame ${n} could not be stored: ${error.message}`);
}

export async function getFrame(runId: string, n: number) {
  const { data, error } = await bucket().download(framePath(runId, n));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Removes a Run's Frames. Best effort: for a Run that failed before it showed anything. */
export async function removeFrames(runId: string, count: number) {
  if (count <= 0) return;
  const paths = Array.from({ length: count }, (_, n) => framePath(runId, n));
  await bucket()
    .remove(paths)
    .catch(() => {});
}
