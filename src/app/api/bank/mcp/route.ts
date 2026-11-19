import { mcpHandler } from "@/features/bank/server/mcp";

// A tool call is one command: a read, or a write in one transaction.
export const maxDuration = 60;

/** The Tidewater Bank MCP server (Streamable HTTP), with its own bearer check. */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
