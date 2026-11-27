import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. */
export const env = {
  /** The Supabase Postgres database, shared by every demo (transaction pooler, port 6543). */
  databaseUrl: () => required("DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** This demo's own key: no fallback to the other demos' keys. */
  aiGatewayApiKey: () => required("PROCESS_TRANSFER_AI_GATEWAY_API_KEY"),
};
