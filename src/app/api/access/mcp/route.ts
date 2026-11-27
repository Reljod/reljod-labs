import { openApi } from "@/features/access/server/api";

/**
 * The Guest access MCP server (Streamable HTTP): a Host manages Guest passes
 * from Claude or another MCP client. The proxy lets it through without
 * cookies (`BEARER_ROUTES`), so it checks its own OAuth bearer on every
 * request.
 */
const handler = openApi.handle(({ services, request }) =>
  services.mcp(request),
);

export { handler as DELETE, handler as GET, handler as POST };
