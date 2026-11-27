import { mcpHandler } from "@/features/name-extraction/server/container";

// Tool calls return as soon as a Run starts; Runs are polled with get_run.
export const maxDuration = 60;

/**
 * The Sieve MCP server (Streamable HTTP). The proxy lets it through without
 * cookies, so it checks its own bearer on every request; its tools run on
 * the same services as the REST routes.
 */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
