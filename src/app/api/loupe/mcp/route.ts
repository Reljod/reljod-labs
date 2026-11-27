import { mcpHandler } from "@/features/loupe/server/container";

// A Check or a piece of code runs in the Sandbox inside one tool call.
export const maxDuration = 120;

/**
 * The Loupe MCP server (Streamable HTTP). The proxy lets it through without
 * cookies, so it checks its own bearer on every request; its tools run on
 * the same services as the REST routes (stubbed only for a token the
 * stubbed e2e suite minted).
 */
export { mcpHandler as DELETE, mcpHandler as GET, mcpHandler as POST };
