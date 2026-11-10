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
  /** Falls back to the document compliance key, which this demo grew out of. */
  aiGatewayApiKey: () =>
    process.env.CASEWORK_AI_GATEWAY_API_KEY ??
    required("DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY"),
  /** Optional: lets an outside MCP client (Claude, an IDE) call the jobs with this bearer token. */
  mcpToken: () => process.env.CASEWORK_MCP_TOKEN ?? "",
};
