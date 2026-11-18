import { mcpHandler } from "@/features/operator/server/mcp";

// Starting a client-driven Run boots its Screen sandbox inside the call.
export const maxDuration = 120;

/** The Operator MCP server (Streamable HTTP), with its own bearer check. */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
