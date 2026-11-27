import { appCallSchema } from "@/features/canvas/domain/api";
import { canvasApi } from "@/features/canvas/server/api";
import { body } from "@/platform/http/middleware";

// One Query in the Sandbox, plus a cold Sandbox start.
export const maxDuration = 120;

/**
 * An App's `tools/call`, proxied by the page's Host to the MCP server: a
 * Control changed, so the View's saved Query runs again. No model is
 * called. Answers the CallToolResult as the MCP server gave it.
 */
export const POST = canvasApi
  .use(body(appCallSchema))
  .handle(({ services, access, caller, origin, body }) =>
    services.host.call(access, caller, origin, body),
  );
