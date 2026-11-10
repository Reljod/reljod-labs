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
   */
  databaseUrl: () => required("CLIENT_MANAGER_DATABASE_URL"),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it skip rate limits and may add Sample clients. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.CLIENT_MANAGER_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /** Reads Sources into facts and links. */
  extractModel: () =>
    process.env.CLIENT_MANAGER_MODEL ?? "openai/gpt-6.1-terra",
  /** A different model checks the first one's work. */
  criticModel: () =>
    process.env.CLIENT_MANAGER_CRITIC_MODEL ?? "anthropic/claude-sonnet-5.5",
  /** Walks the graph to answer questions. */
  chatModel: () =>
    process.env.CLIENT_MANAGER_CHAT_MODEL ?? "openai/gpt-6.1-terra",
  embeddingModel: () => "openai/text-embedding-3-small",
  imageModel: () =>
    process.env.CLIENT_MANAGER_IMAGE_MODEL ?? "bfl/flux-3-image-klein",
};

/** The width of every Node embedding; matches `vector(768)` in the migration. */
export const EMBEDDING_DIMENSIONS = 768;
