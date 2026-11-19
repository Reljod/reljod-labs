import { mcpHandler } from "@/features/canvas/server/mcp";

// A Query or code may run for up to `LIMITS.runSeconds`, plus a Sandbox start.
export const maxDuration = 120;

/**
 * The Canvas MCP server (Streamable HTTP, ADR 0031). The proxy lets it
 * through without cookies (`BEARER_ROUTES`), so it checks its own bearer on
 * every request: a chat turn's token, the page Host's, or a pasted one.
 */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
