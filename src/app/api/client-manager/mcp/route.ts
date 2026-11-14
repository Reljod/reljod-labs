import { mcpHandler } from "@/features/client-manager/server/mcp";

// One embedding per search at most; adding facts starts a Build and returns.
export const maxDuration = 60;

/**
 * The Client Manager MCP server (Streamable HTTP). It checks its own bearer:
 * a token minted on the MCP page for a Host or a Guest (whose token dies with
 * their Guest pass), or the app's own chat token.
 */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
