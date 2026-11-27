import "server-only";
import { hostEmails } from "../domain/guest-pass";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Shorter than this, a salt (which also signs MCP tokens) is guessable. */
export const MIN_SALT_LENGTH = 32;

let warnedShortSalt = false;

/**
 * Warns once per process when RATE_LIMIT_SALT is short. Never throws: a short
 * salt still works, it is only weaker than it should be.
 */
export function warnIfShortSalt(salt: string) {
  if (warnedShortSalt || salt.length >= MIN_SALT_LENGTH) return;
  warnedShortSalt = true;
  console.warn(
    `[access] RATE_LIMIT_SALT is ${salt.length} characters; use at least ${MIN_SALT_LENGTH} (it hashes visitors and signs MCP tokens).`,
  );
}

function rateLimitSalt() {
  const salt = required("RATE_LIMIT_SALT");
  warnIfShortSalt(salt);
  return salt;
}

/** Read lazily so `next build` works without secrets. */
export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /**
   * The project's publishable (or legacy anon) key, for Supabase Auth.
   * Without it nobody can sign in or redeem a code, so the demos stay shut.
   */
  supabasePublishableKey: () =>
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
  rateLimitSalt,
  /** Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`. Empty: cron routes refuse. */
  cronSecret: () => process.env.CRON_SECRET ?? "",
  /** When set, requests carrying it are let through as the e2e suite. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Only these accounts are Hosts. Empty means there are none. */
  hostEmails: () => hostEmails(process.env.ACCESS_HOST_EMAILS ?? ""),
};
