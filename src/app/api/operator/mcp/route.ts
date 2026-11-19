import { mcpHandler } from "@/features/operator/server/mcp";

// Starting a client-driven Run boots its Screen sandbox inside the call, and
// may build the base first; `CLIENT_BOOT_MS` (server/runs.ts) gives up before this.
export const maxDuration = 300;

/** The Operator MCP server (Streamable HTTP), with its own bearer check. */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
