import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  /**
   * A Postgres connection string for the Supabase project (transaction
   * pooler, port 6543). Falls back to the Client Manager's, which reaches the
   * same database.
   */
  databaseUrl: () =>
    process.env.LOUPE_DATABASE_URL ?? required("CLIENT_MANAGER_DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Hashes visitors and signs every Loupe MCP token, so rotating it revokes them. */
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it skip rate limits and are tagged as e2e. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** The Examiner's calls go through the Vercel AI Gateway with this key. */
  aiGatewayApiKey: () =>
    process.env.LOUPE_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /** Overrides the Examiner's default model (domain/contract.ts DEFAULT_MODEL). */
  model: () => process.env.LOUPE_MODEL ?? "",
  /**
   * Whether Vercel Sandbox can be reached: on a Vercel deployment (OIDC), or
   * locally with `VERCEL_OIDC_TOKEN` from `vercel env pull` or an access
   * token. Off, a Sample falls back to its recorded Sweep and an Upload is
   * refused with "Sandbox unavailable".
   */
  sandboxConfigured: () =>
    Boolean(
      process.env.VERCEL ||
        process.env.VERCEL_OIDC_TOKEN ||
        process.env.VERCEL_TOKEN,
    ),
};

/** The private Storage bucket: Uploads, page images and Evidence layers. */
export const BUCKET = "loupe";
