import { mcpHandler } from "@/features/loupe/server/mcp";

// A Check or a piece of code runs in the Sandbox inside one tool call.
export const maxDuration = 120;

/** The Loupe MCP server (Streamable HTTP), with its own bearer check. */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
