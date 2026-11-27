import type { McpToken } from "@/features/operator/domain/api";
import { operatorApi } from "@/features/operator/server/api";

/**
 * A bearer token for an outside MCP client (Claude Code, say) to act for
 * this Owner on /api/operator/mcp. A Guest's lasts as long as their Guest
 * pass and dies when it is revoked; a Host's lasts 30 days.
 */
export const POST = operatorApi.handle(
  ({ services, access, owner, visitor }): McpToken =>
    services.clients.mint(access, owner, visitor),
);
