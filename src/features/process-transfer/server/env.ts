import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. */
export const env = {
  /**
   * A Postgres connection string for the Supabase project. On Vercel use the
   * transaction pooler (port 6543); the client turns prepared statements off.
   * The same database as Client Manager in production.
   */
  databaseUrl: () =>
    process.env.PROCESS_TRANSFER_DATABASE_URL ??
    required("CLIENT_MANAGER_DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** This demo's own key: no fallback to the other demos' keys. */
  aiGatewayApiKey: () => required("PROCESS_TRANSFER_AI_GATEWAY_API_KEY"),
};
