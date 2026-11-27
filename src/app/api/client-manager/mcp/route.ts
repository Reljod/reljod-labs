import { openApi } from "@/features/client-manager/server/api";

// One embedding per search at most; adding facts starts a Build and returns.
export const maxDuration = 60;

/**
 * The Client Manager MCP server (Streamable HTTP). It checks its own bearer:
 * a token minted on the MCP page or by OAuth for a Host or a Guest (whose
 * token dies with their Guest pass). The Desk calls the same server in
 * process. A request with the e2e token reaches the stubbed services.
 */
const handler = openApi.handle(({ services, request }) =>
  services.mcp(request),
);

export { handler as DELETE, handler as GET, handler as POST };
