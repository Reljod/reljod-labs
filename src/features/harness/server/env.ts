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
    process.env.HARNESS_DATABASE_URL ?? required("CLIENT_MANAGER_DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it skip rate limits. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.HARNESS_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /** The Agent in a Session. */
  chatModel: () => process.env.HARNESS_MODEL ?? "anthropic/claude-sonnet-5.5",
  /** Steps that read or draft, and the Conflict check. */
  stepModel: () =>
    process.env.HARNESS_STEP_MODEL ?? "anthropic/claude-haiku-5.5",
  embeddingModel: () =>
    process.env.HARNESS_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
  /** The Runner's address on the VPS. Unset means the Sandbox is off (ADR 0017). */
  sandboxUrl: () => process.env.HARNESS_SANDBOX_URL || null,
  /** Signs the short-lived tokens the Runner accepts. */
  sandboxSecret: () => process.env.HARNESS_SANDBOX_SECRET || null,
};

/** The width of every Passage embedding; matches `vector(768)` in the migration. */
export const EMBEDDING_DIMENSIONS = 768;

/** The private Storage bucket uploaded Sources go to. */
export const BUCKET = "harness";
