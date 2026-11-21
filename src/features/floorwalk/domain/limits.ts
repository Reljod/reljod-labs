/**
 * Caps on paid work and on uploads. A Walk is one model call over the whole
 * footage; an Ask is one more over the same footage. Both are counted per
 * visitor per hour and across everyone per day, before the model is called
 * (`server/rate.ts`).
 */
export const LIMITS = {
  walksPerHour: 6,
  walksPerDay: 150,
  asksPerHour: 20,
  asksPerDay: 400,
  /** Largest upload, bytes. The bucket enforces it too (migration). */
  uploadBytes: 25 * 1024 * 1024,
  /** Longest footage the Walker watches, seconds. */
  uploadSeconds: 90,
  /** Uploads one visitor may start in an hour. */
  uploadsPerHour: 6,
  /** Uploads every visitor together may start in a day. */
  uploadsPerDay: 100,
  /** Uploads filed under an hour older than this are swept on the next visit, Walk, Ask or upload. */
  uploadHours: 6,
  /** Output tokens for one Walk. */
  walkOutputTokens: 12_000,
  askOutputTokens: 2_000,
  /** Longest a Walk may stream before the server gives up. */
  walkSeconds: 240,
  /** A question is at most this many characters. */
  questionChars: 240,
} as const;

/** The private Storage bucket uploads go to (created by the migration). */
export const BUCKET = "floorwalk";

export const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
