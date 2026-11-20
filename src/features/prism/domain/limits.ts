/**
 * Single source of truth for Prism's rate and input caps.
 * Enforced in the server layer before the first Decision Model call.
 */
export const LIMITS = {
  refractionsPerHour: 120,
  tribunalsPerHour: 35,
  cascadesPerHour: 18,
  maxStateChars: 4_000,
  maxCustomQuestions: 6,
  maxOptionsPerQuestion: 8,
  maxCascadeItems: 12,
  maxJurors: 4,
} as const;
