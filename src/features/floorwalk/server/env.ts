import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Gemini 4 Neon (18 Nov 2026): watches video natively, 1M-token context. */
export const DEFAULT_MODEL = "google/gemini-4-neon";

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  /** The Supabase Postgres database, shared by every demo (transaction pooler, port 6543). */
  databaseUrl: () => required("DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Hashes visitors for rate limits. */
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.FLOORWALK_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  model: () => process.env.FLOORWALK_MODEL || DEFAULT_MODEL,
};
