import "server-only";
import { createHash } from "node:crypto";
import { sampleFiles, sampleUrl } from "../domain/corpus";
import { download, samplePath, upload } from "./storage";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * A Sample's file. Samples are static files of the deployment, which a
 * function cannot read from disk, so the bytes come from the bucket, or the
 * first time from the deployment's own address, and are kept in the bucket
 * after that. Either way they are checked against the SHA-256 recorded when
 * the Corpus was rendered: `origin` comes from a request header, and a wrong
 * one must not be able to pass off another file as a Sample.
 */
export async function sampleBytes(
  sampleId: string,
  origin: string,
): Promise<{ bytes: Buffer; file: string }> {
  const files = sampleFiles(sampleId);
  if (!files) throw new Error("No such Sample.");
  const path = samplePath(sampleId, files.file);
  const cached = await download(path);
  if (cached && sha(cached) === files.sha256)
    return { bytes: cached, file: files.file };
  if (!/^https?:\/\/[\w.:-]+$/.test(origin))
    throw new Error("The Sample's file could not be read.");
  const response = await fetch(`${origin}${sampleUrl(sampleId, files.file)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("The Sample's file could not be read.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== files.bytes || sha(bytes) !== files.sha256)
    throw new Error("The Sample's file did not match its recorded hash.");
  await upload(path, bytes).catch(() => {
    // Best effort: the next Examination fetches it again.
  });
  return { bytes, file: files.file };
}
