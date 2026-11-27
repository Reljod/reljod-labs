import { canvas } from "@/features/canvas/server/container";
import { mcpHandler } from "@/features/canvas/server/mcp";

// A Query or code may run for up to `LIMITS.runSeconds`, plus a Sandbox start.
export const maxDuration = 120;

/**
 * The Canvas MCP server (Streamable HTTP, ADR 0031). The proxy lets it
 * through without cookies (`BEARER_ROUTES`), so it checks its own bearer on
 * every request: a chat turn's token, the page Host's, or a pasted one. Its
 * tools run on the same services as the REST routes; the token says whether
 * on the live adapters or the e2e suite's canned ones.
 */
const serve = (request: Request) => mcpHandler(request, canvas);

export { serve as DELETE, serve as GET, serve as POST };
