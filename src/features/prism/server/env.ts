import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  /** Supabase transaction pooler (port 6543). Falls back to Client Manager's, reaching the same database. */
  databaseUrl: () =>
    process.env.PRISM_DATABASE_URL?.trim() ||
    required("CLIENT_MANAGER_DATABASE_URL"),
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.PRISM_AI_GATEWAY_API_KEY?.trim() ||
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /** Shared salt for hashing visitor IPs into rate-limit keys. */
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it skip hourly rate limits. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN?.trim() ?? "",
};
