import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Read lazily so `next build` works without secrets. */
export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  rateLimitSalt: () => required("RATE_LIMIT_SALT"),
  /** When set, requests carrying it skip rate limits and are tagged as e2e. */
  e2eBypassToken: () => process.env.E2E_BYPASS_TOKEN ?? "",
  aiGatewayApiKey: () => required("LEDGER_AI_GATEWAY_API_KEY"),
  /** A Vercel AI Gateway model id, `provider/model`. */
  model: () => process.env.LEDGER_MODEL ?? "zai/glm-5.3-flash",
};
