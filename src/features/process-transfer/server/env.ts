import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/**
 * Read lazily so `next build` works without secrets. The database URL and
 * the rate-limit salt come from the shared modules (`@/server/postgres`,
 * `@/platform/request/visitor`).
 */
export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** This demo's own key: no fallback to the other demos' keys. */
  aiGatewayApiKey: () => required("PROCESS_TRANSFER_AI_GATEWAY_API_KEY"),
};
