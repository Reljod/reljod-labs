import { mcpHandler } from "@/features/switchboard/server/mcp";

// `caller_says` waits for the Agent's whole Turn, tool calls included.
export const maxDuration = 120;

/** The Switchboard MCP server (Streamable HTTP), with its own bearer check. */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
