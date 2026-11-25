/** Hard caps for Helio, enforced in server routes before any paid model call. */
export const LIMITS = {
  /** Maximum image generations/edits per visitor per rolling hour. */
  imageCallsPerHour: 24,
  /** Maximum image generations/edits globally per rolling 24 hours. */
  imageCallsPerDayGlobal: 400,
  /** Maximum Neon director/audit calls per visitor per rolling hour. */
  directorCallsPerHour: 40,
  /** Maximum Neon calls globally per rolling 24 hours. */
  directorCallsPerDayGlobal: 600,
  /** Maximum markets shot in a single campaign burst. */
  maxMarketsPerShoot: 3,
  /**
   * Maximum raw bytes for a single uploaded/encoded image (~1.05 MB raw -> ~1.4 MB
   * base64) so multi-image requests stay comfortably under Vercel's 4.5 MB body cap.
   */
  maxUploadBytes: 1_050_000,
  /**
   * Maximum combined raw image bytes across all image fields in one request
   * (~2.8 MB raw -> ~3.75 MB base64, safely below Vercel Functions' 4.5 MB limit).
   */
  maxRequestImagesBytes: 2_800_000,
  /** Maximum source file size accepted in the browser before client-side compression. */
  maxBrowserFileBytes: 15 * 1024 * 1024,
  /** Maximum length of a custom product concept or director note. */
  maxPromptChars: 360,
  /** Maximum version history items kept per campaign slot in browser state. */
  maxVersionHistory: 6,
} as const;
