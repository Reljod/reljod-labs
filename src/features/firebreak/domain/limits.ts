/**
 * Caps on paid work. A Turn is one Round on the server (a Reader call when
 * the executive wrote their own words, then one Room call); a Debrief is the
 * Review's Statement and its revisions. Both are counted per visitor per hour
 * and across everyone per day, in `server/rate.ts`, before any model call.
 */
export const LIMITS = {
  turnsPerHour: 48,
  turnsPerDay: 1500,
  debriefsPerHour: 8,
  debriefsPerDay: 250,
  /** Longest decision an executive may type. */
  ownWords: 400,
  /** Echoed Room lines sent back for continuity, each. */
  echoChars: 320,
  /** Drafts of the Statement, the first included. */
  drafts: 3,
  /** Longest a Turn or a Debrief may stream before the server gives up. */
  seconds: 120,
  /** Output tokens per model call. */
  outputTokens: 4_000,
} as const;
