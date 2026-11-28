import { casework } from "@/features/casework/server/container";
import { modeOf } from "@/platform/request/mode";

// Tool calls return as soon as a run starts; runs stream on their own route.
export const maxDuration = 60;

/**
 * The Casework MCP server: every Job and Pipeline as a tool (Streamable
 * HTTP). Bearer-authenticated (a desk session token or CASEWORK_MCP_TOKEN),
 * so it is off the cookie gate and the same-origin check, and calls the same
 * services as the REST routes.
 */
function handle(request: Request) {
  return casework(modeOf(request.headers)).mcp(request);
}

export { handle as DELETE, handle as GET, handle as POST };
