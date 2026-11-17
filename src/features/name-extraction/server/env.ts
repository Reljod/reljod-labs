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
  /** The Analyst's and the Readers' calls go through the Vercel AI Gateway with this key. */
  aiGatewayApiKey: () => required("NAME_EXTRACTION_AI_GATEWAY_API_KEY"),
  /** Optional: lets an outside MCP client call the tools with this bearer token. */
  mcpToken: () => process.env.NAME_EXTRACTION_MCP_TOKEN ?? "",
};
