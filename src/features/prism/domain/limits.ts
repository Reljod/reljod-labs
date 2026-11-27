/**
 * Single source of truth for Prism's rate and input caps.
 * Enforced in Postgres (behind an advisory lock) before the first Decision
 * Model call, counting actual Decision Model calls rather than raw requests.
 */
export const LIMITS = {
  refractionsPerHour: 120,
  tribunalCallsPerHour: 120,
  cascadeCallsPerHour: 120,
  /**
   * Decision Model calls from everyone, per kind, per day. Together they are
   * the old 6,000 a day for all kinds: the shared limiter counts each kind's
   * hits under its own lock, so a ceiling across kinds is three ceilings.
   */
  refractionsPerDay: 2_000,
  tribunalCallsPerDay: 2_000,
  cascadeCallsPerDay: 2_000,
  maxStateChars: 4_000,
  maxCustomQuestions: 6,
  maxOptionsPerQuestion: 8,
  maxCascadeItems: 12,
  maxJurors: 4,
} as const;
