import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Owner } from "@/features/access/domain/owner";
import { BUCKET, env } from "./env";

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

/** A stable, non-reversible folder per Owner: no raw input reaches a storage key. */
export function ownerFolder(owner: Owner) {
  return createHash("sha256")
    .update(`loupe:${owner}`)
    .digest("hex")
    .slice(0, 32);
}

/** Where an Upload lives. The id is a server-made uuid and the extension comes from a fixed map. */
export function uploadPath(owner: Owner, uploadId: string, extension: string) {
  return `u/${ownerFolder(owner)}/${uploadId}.${extension}`;
}

/**
 * The keys an Examination's files may have: its page images, its Evidence
 * layers and what the Examiner looked at. Anything else is refused, so a key
 * from a URL or from code in the Sandbox can never leave the Examination's
 * own folder.
 */
const ASSET_KEY = /^(pages|layers|looks)\/[A-Za-z0-9][\w.-]{0,100}\.(png|jpg)$/;

export function isAssetKey(key: unknown): key is string {
  return typeof key === "string" && ASSET_KEY.test(key) && !key.includes("..");
}

export function assetPath(owner: Owner, examinationId: string, key: string) {
  if (!isAssetKey(key)) throw new Error("Not an asset key");
  return `x/${ownerFolder(owner)}/${examinationId}/${key}`;
}

/** A Sample's file, cached in the bucket once its hash was checked (server/corpus.ts). */
export function samplePath(sampleId: string, fileName: string) {
  return `samples/${sampleId}/${fileName}`;
}

export function contentTypeOf(path: string) {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export async function download(path: string): Promise<Buffer | null> {
  const { data, error } = await bucket().download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function upload(path: string, bytes: Buffer | Uint8Array) {
  const { error } = await bucket().upload(path, bytes, {
    contentType: contentTypeOf(path),
    upsert: true,
  });
  if (error) throw new Error(`Storage write failed: ${error.message}`);
}

/** A signed URL the browser PUTs one file to. */
export async function signedUpload(path: string) {
  const { data, error } = await bucket().createSignedUploadUrl(path, {
    upsert: false,
  });
  if (error || !data) return null;
  return { signedUrl: data.signedUrl, token: data.token, path };
}

/** The size of a stored object, or null when it is not there. */
export async function storedSize(path: string): Promise<number | null> {
  const slash = path.lastIndexOf("/");
  const { data, error } = await bucket().list(path.slice(0, slash), {
    search: path.slice(slash + 1),
    limit: 2,
  });
  if (error || !data) return null;
  const hit = data.find((item) => item.name === path.slice(slash + 1));
  const size = (hit?.metadata as { size?: number } | undefined)?.size;
  return typeof size === "number" ? size : null;
}
