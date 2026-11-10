/** Every number that bounds a Guest pass, in one place. */
export const LIMITS = {
  /** How long a Guest pass may last. */
  durationsHours: [1, 4, 24, 72, 168],
  defaultDurationHours: 24,
  /** How many browsers may redeem one Guest code. */
  maxDevices: 5,
  defaultDevices: 2,
  /** Guest passes that may be live at once. */
  maxLivePasses: 25,
  labelLength: 60,
  nameLength: 60,
  passwordMinLength: 8,
  /** Longer passwords are cut short by the hash Supabase Auth uses. */
  passwordMaxLength: 72,
  /** Wrong codes or passwords one visitor may try before waiting. */
  failedAttempts: 8,
  attemptWindowMinutes: 15,
} as const;

export type GuestPassStatus = "live" | "expired" | "revoked";

export function guestPassStatus(
  pass: { expiresAt: string; revokedAt: string | null },
  now = Date.now(),
): GuestPassStatus {
  if (pass.revokedAt) return "revoked";
  return Date.parse(pass.expiresAt) > now ? "live" : "expired";
}

export function durationLabel(hours: number) {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** What the Host asked for, or null when it is outside the limits. */
export function parseGuestPassRequest(input: {
  label: unknown;
  hours: unknown;
  devices: unknown;
}) {
  const label = String(input.label ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const hours = Number(input.hours);
  const devices = Number(input.devices);
  if (!label || label.length > LIMITS.labelLength) return null;
  if (!(LIMITS.durationsHours as readonly number[]).includes(hours))
    return null;
  if (!Number.isInteger(devices) || devices < 1 || devices > LIMITS.maxDevices)
    return null;
  return { label, hours, devices };
}

/** A Host's display name as typed, tidied. Empty clears it; null is too long. */
export function parseDisplayName(input: unknown) {
  const name = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return name.length <= LIMITS.nameLength ? name : null;
}

/** Why a new password is refused, or null when it will do. */
export function passwordProblem(input: {
  current: string;
  next: string;
  confirm: string;
}) {
  if (input.next.length < LIMITS.passwordMinLength)
    return `Use at least ${LIMITS.passwordMinLength} characters.`;
  if (input.next.length > LIMITS.passwordMaxLength)
    return `Use at most ${LIMITS.passwordMaxLength} characters.`;
  if (input.next !== input.confirm) return "The two new passwords differ.";
  if (input.next === input.current)
    return "The new password is the same as the current one.";
  return null;
}

const GATED = [/^\/demos(\/|$)/, /^\/ask(\/|$)/];

/**
 * Where to go after the door: a demo on this site, never another site.
 * Anything else falls back to the list of demos.
 */
export function safeNextPath(next: unknown) {
  const fallback = "/#demos";
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || /[\\\s]/.test(next)) return fallback;
  const path = next.split(/[?#]/)[0];
  return GATED.some((pattern) => pattern.test(path)) ? next : fallback;
}

/** The emails that may sign in as a Host, from `ACCESS_HOST_EMAILS`. */
export function hostEmails(list: string) {
  return list
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
