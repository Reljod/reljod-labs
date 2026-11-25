/**
 * Caps on paid work. Each Pass is one call to the model, so a Pass is what is
 * counted: per visitor per hour, and across every visitor per day. Applied in
 * `server/trace.ts` before the model is called.
 */
export const LIMITS = {
  /** Passes one visitor may start in an hour. */
  passesPerHour: 12,
  /** Passes every visitor together may start in a day. */
  passesPerDay: 300,
  /** The most Passes in one Trace (the `passes` Rule's ceiling). */
  passesPerTrace: 4,
  /** Largest image the browser may send, decoded, per image. */
  imageBytes: 1_500_000,
  /** Longest side of an image sent to the model, in pixels. */
  imageSide: 1600,
  /** Notes from the Ruler sent with a later Pass. */
  notes: 16,
  /** Longest a Pass may stream before the server gives up. */
  passSeconds: 240,
  /** Output tokens for one Pass. */
  outputTokens: 32_000,
} as const;
