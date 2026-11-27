/**
 * Single source of truth for Prism's rate and input caps.
 * Enforced in Postgres (behind an advisory lock) before the first Decision
 * Model call, counting actual Decision Model calls rather than raw requests.
 */
export const LIMITS = {
  refractionsPerHour: 120,
  tribunalCallsPerHour: 120,
  cascadeCallsPerHour: 120,
  /** Decision Model calls from everyone, all kinds together, per day. */
  callsPerDay: 6_000,
  maxStateChars: 4_000,
  maxCustomQuestions: 6,
  maxOptionsPerQuestion: 8,
  maxCascadeItems: 12,
  maxJurors: 4,
} as const;

/** Whether `units` more calls fit under the visitor's hour and everyone's day. Pure. */
export function rateVerdict(input: {
  units: number;
  perHour: number;
  usedHour: number;
  usedDay: number;
}): "taken" | "hour" | "day" {
  if (input.usedHour + input.units > input.perHour) return "hour";
  if (input.usedDay + input.units > LIMITS.callsPerDay) return "day";
  return "taken";
}
