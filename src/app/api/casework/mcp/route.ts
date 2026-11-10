import { mcpHandler } from "@/features/casework/server/mcp";

// Tool calls return as soon as a run starts; runs stream on their own route.
export const maxDuration = 60;

/** The Casework MCP server: every Job and Pipeline as a tool (Streamable HTTP). */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
