import "server-only";
import { hostEmails } from "../domain/guest-pass";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
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
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it are let through as the e2e suite. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Only these accounts are Hosts. Empty means there are none. */
  hostEmails: () => hostEmails(process.env.ACCESS_HOST_EMAILS ?? ""),
};
