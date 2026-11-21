import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Owner } from "@/features/access/domain/owner";
import { mp4DurationSeconds } from "@/features/process-transfer/domain/uploads";
import type { Source } from "../domain/api";
import { LIMITS } from "../domain/limits";
import { type Site, siteBySlug } from "../domain/sites";
import { InvalidError } from "./errors";
import { download } from "./storage";

export type Footage = {
  bytes: Uint8Array;
  mediaType: "video/mp4" | "video/quicktime";
  seconds: number;
  site: Site | null;
};

/** The Storage folder an Owner's uploads live in. Owners are `host:…`, `guest:…` or `e2e`. */
export function uploadFolder(owner: Owner): string {
  return `uploads/${owner.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
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
        const response = await fetch(new URL(file, origin));
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
  if (!source.path.startsWith(`${uploadFolder(owner)}/`))
    throw new InvalidError("That upload is not one of yours.");
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
