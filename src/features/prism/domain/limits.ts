/**
 * Single source of truth for Prism's rate and input caps.
 * Enforced in Postgres (behind an advisory lock) before the first Decision
 * Model call, counting actual Decision Model calls rather than raw requests.
 */
export const LIMITS = {
  refractionsPerHour: 120,
  tribunalCallsPerHour: 120,
  cascadeCallsPerHour: 120,
  maxStateChars: 4_000,
  maxCustomQuestions: 6,
  maxOptionsPerQuestion: 8,
  maxCascadeItems: 12,
  maxJurors: 4,
} as const;
