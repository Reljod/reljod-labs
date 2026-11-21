/**
 * Where uploads live, as pure functions: `uploads/<hour>/<owner>/<uuid>.mp4`.
 * Filing by UTC hour lets expired footage be swept in whole hours, for every
 * Owner at once, without a table of uploads.
 */
import { LIMITS } from "./limits";

/** An Owner (`host:…`, `guest:…`, `e2e`) as a folder name. */
export function ownerSlug(owner: string): string {
  return owner.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

/** The UTC hour a moment falls in, `YYYYMMDDHH`. */
export function uploadHour(now = new Date()): string {
  return now.toISOString().slice(0, 13).replace(/[-T]/g, "");
}

/** The hour folders older than the retention, oldest first. Anything else is left alone. */
export function expiredHours(
  names: readonly string[],
  now = new Date(),
): string[] {
  const cutoff = uploadHour(
    new Date(now.getTime() - LIMITS.uploadHours * 3600 * 1000),
  );
  return names.filter((name) => /^\d{10}$/.test(name) && name < cutoff).sort();
}

/** True when an upload path sits in this Owner's folder (any hour). */
export function ownsUpload(path: string, owner: string): boolean {
  const [root, hour, folder] = path.split("/");
  return (
    root === "uploads" &&
    /^\d{10}$/.test(hour ?? "") &&
    folder === ownerSlug(owner)
  );
}
