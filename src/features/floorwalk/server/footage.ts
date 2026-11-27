import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Owner } from "@/features/access/domain/owner";
import { mp4DurationSeconds } from "@/features/process-transfer/domain/uploads";
import type { Source } from "../domain/api";
import { LIMITS } from "../domain/limits";
import { type Site, siteBySlug } from "../domain/sites";
import { ownerSlug, ownsUpload, uploadHour } from "../domain/uploads";
import { InvalidError } from "./errors";
import { download } from "./storage";

export type Footage = {
  bytes: Uint8Array;
  mediaType: "video/mp4" | "video/quicktime";
  seconds: number;
  site: Site | null;
};

/** Where a new upload goes: `uploads/<hour>/<owner>/`. */
export function uploadFolder(owner: Owner, now = new Date()): string {
  return `uploads/${uploadHour(now)}/${ownerSlug(owner)}`;
}

/**
 * Refuses an upload that is not in the caller's own folder. Cheap, so the
 * routes run it before they take the rate, and `loadFootage` runs it again.
 */
export function assertOwnSource(source: Source, owner: Owner) {
  if (source.kind === "upload" && !ownsUpload(source.path, owner))
    throw new InvalidError("That upload is not one of yours.");
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Where a Sample's file may be fetched from when it is not on disk: this
 * deployment's own address (`VERCEL_URL` first), never a host the request
 * named. The request's origin is used only in development, and only when it
 * is a local server. With neither, there is nowhere to fetch from.
 */
export function sampleOrigin(
  origin: string,
): { base: string; own: boolean } | null {
  const own = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].find((host): host is string => Boolean(host));
  if (own) return { base: `https://${own}`, own: true };
  if (process.env.NODE_ENV !== "production" && LOCAL.test(origin))
    return { base: origin, own: false };
  return null;
}

/**
 * The bytes the Walker watches. A Sample is a static file; an upload must sit
 * in the caller's own folder, be an MP4 or MOV the server can read the length
 * of, and be short enough. All of it is checked before any model call.
 */
export async function loadFootage(
  source: Source,
  owner: Owner,
  origin: string,
): Promise<Footage> {
  if (source.kind === "sample") {
    const site = siteBySlug(source.slug);
    if (!site) throw new InvalidError("That Sample is not available.");
    const file = `/floorwalk/samples/${site.slug}.mp4`;
    const bytes = await readFile(path.join(process.cwd(), "public", file))
      .then((buffer) => new Uint8Array(buffer))
      .catch(async () => {
        const target = sampleOrigin(origin);
        if (!target) throw new Error("The Sample's file could not be read.");
        // The protection bypass goes to this deployment only.
        const bypass = target.own
          ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          : undefined;
        const response = await fetch(new URL(file, target.base), {
          headers: bypass
            ? { "x-vercel-protection-bypass": bypass }
            : undefined,
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Sample fetch ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      });
    return {
      bytes,
      mediaType: "video/mp4",
      seconds: mp4DurationSeconds(bytes) ?? 0,
      site,
    };
  }
  assertOwnSource(source, owner);
  const bytes = await download(source.path);
  if (!bytes) throw new InvalidError("That upload has gone. Upload it again.");
  if (bytes.byteLength > LIMITS.uploadBytes)
    throw new InvalidError("That file is over 25 MB.");
  const seconds = mp4DurationSeconds(bytes);
  if (seconds === null)
    throw new InvalidError(
      "Floorwalk could not read that video's length. Upload an MP4 or MOV.",
    );
  if (seconds > LIMITS.uploadSeconds)
    throw new InvalidError(
      `That video is ${Math.round(seconds)} seconds; Floorwalk walks up to ${LIMITS.uploadSeconds}.`,
    );
  return {
    bytes,
    mediaType: source.path.endsWith(".mov") ? "video/quicktime" : "video/mp4",
    seconds,
    site: null,
  };
}
