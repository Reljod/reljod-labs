import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sampleFiles, sampleUrl } from "../domain/corpus";
import { download, samplePath, upload } from "./storage";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Where a Sample may be fetched from. `origin` comes from a request header,
 * so it is used only when it names this deployment or, in development, a
 * local server; on Vercel anything else falls back to the deployment's own
 * address. Only this deployment ever gets the protection-bypass secret.
 */
export function fetchOrigin(origin: string): {
  origin: string;
  own: boolean;
} | null {
  const known = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .filter((host): host is string => Boolean(host))
    .map((host) => `https://${host}`);
  if (known.includes(origin)) return { origin, own: true };
  if (known[0]) return { origin: known[0], own: true };
  if (process.env.NODE_ENV !== "production" && LOCAL.test(origin))
    return { origin, own: false };
  return null;
}

/**
 * A Sample's file. Reads from `public/loupe/samples/` on disk first (bundled
 * into the function via `outputFileTracingIncludes`), then the bucket cache,
 * then the deployment's own address (carrying Vercel's protection-bypass
 * header if set, to this deployment only). Either way it is checked against
 * the SHA-256 recorded when the Corpus was rendered.
 */
export async function sampleBytes(
  sampleId: string,
  origin: string,
): Promise<{ bytes: Buffer; file: string }> {
  const files = sampleFiles(sampleId);
  if (!files) throw new Error("No such Sample.");
  const url = sampleUrl(sampleId, files.file);
  const disk = await readFile(path.join(process.cwd(), "public", url)).catch(
    () => null,
  );
  if (disk && disk.length === files.bytes && sha(disk) === files.sha256)
    return { bytes: disk, file: files.file };
  const bucketKey = samplePath(sampleId, files.file);
  const cached = await download(bucketKey);
  if (cached && cached.length === files.bytes && sha(cached) === files.sha256)
    return { bytes: cached, file: files.file };
  const target = fetchOrigin(origin);
  if (!target) throw new Error("The Sample's file could not be read.");
  const bypass = target.own
    ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    : undefined;
  const response = await fetch(`${target.origin}${url}`, {
    cache: "no-store",
    headers: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("The Sample's file could not be read.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== files.bytes || sha(bytes) !== files.sha256)
    throw new Error("The Sample's file did not match its recorded hash.");
  await upload(bucketKey, bytes).catch(() => {
    // Best effort: the next Examination reads from disk or fetches it again.
  });
  return { bytes, file: files.file };
}
