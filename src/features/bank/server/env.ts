import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  /** Supabase transaction pooler (port 6543). Falls back to the Client Manager's: the same database. */
  databaseUrl: () =>
    process.env.BANK_DATABASE_URL ?? required("CLIENT_MANAGER_DATABASE_URL"),
  /** Shared; it also signs every bank MCP token, so rotating it revokes them. */
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  aiGatewayApiKey: () =>
    process.env.BANK_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /** The Teller. */
  chatModel: () => process.env.BANK_MODEL ?? "anthropic/claude-sonnet-5.5",
  /** The one model call of Growth triage. */
  triageModel: () =>
    process.env.BANK_TRIAGE_MODEL ?? "anthropic/claude-haiku-5.5",
  /**
   * A fine-grained GitHub token with Issues read/write (and Pull requests
   * read) on the one repository. Without it a Growth request stops at
   * "Triaged, waiting for a token".
   */
  githubToken: () => process.env.BANK_GITHUB_TOKEN ?? "",
  githubRepo: () => process.env.BANK_GITHUB_REPO ?? "Reljod/reljod-labs",
  /** Optional: verifies GitHub's webhook deliveries. Without it the route answers 404. */
  githubWebhookSecret: () => process.env.BANK_GITHUB_WEBHOOK_SECRET ?? "",
  /** The commit this deployment was built from, to tell "merged" from "live". */
  buildSha: () => process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  sandboxConfigured: () =>
    Boolean(
      process.env.VERCEL ||
        process.env.VERCEL_OIDC_TOKEN ||
        process.env.VERCEL_TOKEN,
    ),
};
