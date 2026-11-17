import { mcpHandler } from "@/features/name-extraction/server/mcp";

// Tool calls return as soon as a Run starts; Runs are polled with get_run.
export const maxDuration = 60;

/** The Sieve MCP server (Streamable HTTP), with its own bearer check. */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
