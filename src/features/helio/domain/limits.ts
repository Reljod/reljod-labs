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
  /** Maximum upload size for a visitor's product or reference image (6 MB). */
  maxUploadBytes: 6 * 1024 * 1024,
  /** Maximum length of a custom product concept or director note. */
  maxPromptChars: 360,
  /** Maximum version history items kept per campaign slot in browser state. */
  maxVersionHistory: 6,
} as const;
