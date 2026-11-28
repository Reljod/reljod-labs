/*
 * What a Desk takes as an upload. The browser's word on a file's type, size
 * and pages only opens a slot; what is recorded is checked against the object
 * Storage actually holds (`finish` in server/services/uploads.ts). The bucket
 * enforces the same types and size (supabase/migrations/20261127130100_casework_uploads.sql).
 */

export const UPLOADS = {
  /** Largest file, and largest rendered page, in bytes. Also the bucket's limit. */
  maxBytes: 10 * 1024 * 1024,
  /** Uploads one Desk holds. */
  perDesk: 30,
  /** Page images taken from one PDF. */
  maxPages: 12,
  /** How long a ticket from `beginUpload` may be finished, in ms: as long as its signed URLs last. */
  ticketMs: 2 * 60 * 60 * 1000,
  /** The types Storage accepts, as the browser is told to send them. */
  mediaTypes: ["application/pdf", "text/csv", "image/jpeg", "image/png"],
} as const;

export type UploadMediaType = (typeof UPLOADS.mediaTypes)[number];

/** How many leading bytes `looksLike` needs. */
export const SNIFF_BYTES = 512;

const startsWith = (bytes: Uint8Array, magic: number[]) =>
  bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/**
 * Whether a file's first bytes are what its type says: the PDF, PNG and JPEG
 * signatures, and for a CSV, text with no NUL byte that is none of those.
 */
export function looksLike(bytes: Uint8Array, mediaType: string): boolean {
  switch (mediaType) {
    case "application/pdf":
      return startsWith(bytes, PDF);
    case "image/png":
      return startsWith(bytes, PNG);
    case "image/jpeg":
      return startsWith(bytes, JPEG);
    case "text/csv":
      return (
        bytes.length > 0 &&
        !bytes.subarray(0, SNIFF_BYTES).includes(0) &&
        ![PDF, PNG, JPEG].some((magic) => startsWith(bytes, magic))
      );
    default:
      return false;
  }
}

/** Why a stored object is refused, or null when it is what the ticket said. */
export function storedProblem(
  stored: { size: number; head: Uint8Array } | null,
  mediaType: string,
): string | null {
  if (!stored) return "was not uploaded";
  if (!(stored.size > 0)) return "is empty";
  if (stored.size > UPLOADS.maxBytes) return "is over 10 MB";
  if (!looksLike(stored.head, mediaType)) return "is not the type it claimed";
  return null;
}

/** A ticket's time is up, or it has none (it came from before tickets expired). */
export function ticketExpired(expiresAt: unknown, now = Date.now()): boolean {
  return typeof expiresAt !== "number" || !(expiresAt > now);
}
