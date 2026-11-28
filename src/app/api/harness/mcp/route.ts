import { harness } from "@/features/harness/server/container";
import { mcpHandler } from "@/features/harness/server/mcp";
import { modeOf } from "@/platform/request/mode";

// A Pipeline tool starts a Run and returns; ingesting a Source reads and embeds it.
export const maxDuration = 60;

/**
 * The Harness MCP server (Streamable HTTP, ADR 0013). The proxy lets it
 * through without cookies (`BEARER_ROUTES`), so it checks its own bearer on
 * every request: a chat turn's token, an OAuth access token or a pasted one.
 * Its tools run on the same services as the REST routes (stubbed only for
 * the e2e suite).
 */
const serve = (request: Request) =>
  mcpHandler(request, harness(modeOf(request.headers)));

export { serve as DELETE, serve as GET, serve as POST };
