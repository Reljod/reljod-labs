import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** The model that answered when the Gateway did not say. */
export const DEFAULT_MODEL = "openai/gpt-6.2-astra";

const REASONING = ["low", "medium", "high"] as const;
export type Reasoning = (typeof REASONING)[number];

/** Read lazily so `next build` works without secrets. Values are never logged. */
export const env = {
  /** Supabase transaction pooler; falls back to the Client Manager's, the same database. */
  databaseUrl: () =>
    process.env.VELLUM_DATABASE_URL ?? required("CLIENT_MANAGER_DATABASE_URL"),
  /** Hashes visitors for rate limits. */
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  /** Falls back to the document compliance key, like the other demos. */
  aiGatewayApiKey: () =>
    process.env.VELLUM_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  model: () => process.env.VELLUM_MODEL || DEFAULT_MODEL,
  reasoning: (): Reasoning => {
    const value = process.env.VELLUM_REASONING;
    return REASONING.includes(value as Reasoning)
      ? (value as Reasoning)
      : "low";
  },
};
