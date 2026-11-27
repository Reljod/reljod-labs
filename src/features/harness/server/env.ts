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
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it skip rate limits. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.JOD_BANKING_HARNESS_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /** The Agent in a Session. */
  chatModel: () => process.env.HARNESS_MODEL ?? "anthropic/claude-sonnet-5.5",
  /** Steps that read or draft, and the Conflict check. */
  stepModel: () =>
    process.env.HARNESS_STEP_MODEL ?? "anthropic/claude-haiku-5.5",
  embeddingModel: () =>
    process.env.HARNESS_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
  /**
   * Whether Vercel Sandbox can be reached (ADR 0022): on a Vercel deployment
   * (OIDC), or locally with `VERCEL_OIDC_TOKEN` from `vercel env pull` or an
   * access token. Off, the code tools answer "Sandbox unavailable".
   */
  sandboxConfigured: () =>
    Boolean(
      process.env.VERCEL ||
        process.env.VERCEL_OIDC_TOKEN ||
        process.env.VERCEL_TOKEN,
    ),
};

/** The width of every Passage embedding; matches `vector(768)` in the migration. */
export const EMBEDDING_DIMENSIONS = 768;

/** The private Storage bucket uploaded Sources go to. */
export const BUCKET = "harness";
