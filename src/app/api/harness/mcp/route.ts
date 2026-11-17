import { mcpHandler } from "@/features/harness/server/mcp";

// A Pipeline tool starts a Run and returns; ingesting a Source reads and embeds it.
export const maxDuration = 60;

/**
 * The Harness MCP server (Streamable HTTP, ADR 0013). The proxy lets it
 * through without cookies (`BEARER_ROUTES`), so it checks its own bearer on
 * every request: a chat turn's token, an OAuth access token or a pasted one.
 */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
