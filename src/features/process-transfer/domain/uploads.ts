import type { Owner } from "@/features/access/domain/owner";
import { LIMITS, UPLOAD_TYPES, type UploadType } from "./limits";

/*
 * Where an uploaded Recording lives in the private bucket, and what may be
 * uploaded. The browser's file name never reaches a Storage key: the key is
 * the Owner's prefix, a fresh uuid and the extension of the declared type.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `host:<uuid>` → `host-<uuid>`: a Storage-safe folder per Owner. */
export function ownerPrefix(owner: Owner): string {
  return `recordings/${owner.replace(":", "-")}`;
}

export function isUploadType(type: string): type is UploadType {
  return Object.hasOwn(UPLOAD_TYPES, type);
}

export function recordingPath(
  owner: Owner,
  type: UploadType,
  id: string,
): string {
  return `${ownerPrefix(owner)}/${id}.${UPLOAD_TYPES[type]}`;
}

/** The upload type a path was made for, when it is one of this Owner's Recordings. */
export function ownRecordingType(
  owner: Owner,
  path: string,
): UploadType | null {
  const prefix = ownerPrefix(owner).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const extensions = Object.values(UPLOAD_TYPES).join("|");
  const match = new RegExp(`^${prefix}/${UUID}\\.(${extensions})$`).exec(path);
  if (!match) return null;
  const extension = match[1];
  return (
    (Object.keys(UPLOAD_TYPES) as UploadType[]).find(
      (type) => UPLOAD_TYPES[type] === extension,
    ) ?? null
  );
}

/** Why an upload is refused, or null. */
export function uploadProblem(input: {
  name: unknown;
  size: unknown;
  type: unknown;
}): string | null {
  if (typeof input.type !== "string" || !isUploadType(input.type)) {
    return "Upload an MP4 or MOV video.";
  }
  if (
    typeof input.size !== "number" ||
    !Number.isFinite(input.size) ||
    input.size <= 0
  ) {
    return "That file is empty.";
  }
  if (input.size > LIMITS.uploadBytes) {
    return `A Recording may be at most ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB; that one is ${(input.size / 1024 / 1024).toFixed(1)} MB.`;
  }
  if (typeof input.name !== "string" || input.name.trim() === "") {
    return "The file has no name.";
  }
  return null;
}

/** A file name to show, never to build a path from. */
export function displayName(name: string): string {
  const clean = name
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || "Recording").slice(0, 120);
}

/**
 * The duration of an MP4 or MOV from its `mvhd` box, or null when it cannot
 * be read (another container, or a box this does not understand).
 */
export function mp4DurationSeconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const walk = (start: number, end: number): number | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return null;
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) return null;
      const kind = type(at + 4);
      if (kind === "moov") return walk(at + header, at + size);
      if (kind === "mvhd") {
        const body = at + header;
        const version = bytes[body];
        if (version === 1) {
          if (body + 32 > end) return null;
          const scale = view.getUint32(body + 20);
          const duration = Number(view.getBigUint64(body + 24));
          return scale > 0 && duration > 0 ? duration / scale : null;
        }
        if (body + 20 > end) return null;
        const scale = view.getUint32(body + 12);
        const duration = view.getUint32(body + 16);
        // Fragmented MP4s leave the duration 0: their length cannot be read here.
        return scale > 0 && duration > 0 ? duration / scale : null;
      }
      at += size;
    }
    return null;
  };
  return walk(0, bytes.byteLength);
}
