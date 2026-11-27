import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  /** The Supabase Postgres database, shared by every demo (transaction pooler, port 6543). */
  databaseUrl: () => required("DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Shared; it also signs every Operator MCP token, so rotating it revokes them. */
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it skip rate limits and may ask for the scripted Operator. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.OPERATOR_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /**
   * Whether Vercel Sandbox can be reached: on a Vercel deployment (OIDC), or
   * locally with `VERCEL_OIDC_TOKEN` from `vercel env pull` or an access
   * token. Without it no Screen can be shown, so a Run is refused.
   */
  sandboxConfigured: () =>
    Boolean(
      process.env.VERCEL ||
        process.env.VERCEL_OIDC_TOKEN ||
        process.env.VERCEL_TOKEN,
    ),
};

/** The private Storage bucket Frames and attached Manifests go to. */
export const BUCKET = "operator";
