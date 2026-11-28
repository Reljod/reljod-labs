import {
  type ToolResponse,
  toolRequestSchema,
} from "@/features/switchboard/domain/api";
import { callPath, switchboardApi } from "@/features/switchboard/server/api";
import { body, params } from "@/platform/http/middleware";

/**
 * The voice Session's tool bridge: the realtime model asked for a tool, the
 * browser passes the call here, and the Back office (not the browser, not
 * the model) decides. The same Calls service the MCP server and the text
 * Line use.
 */
export const POST = switchboardApi
  .use(params(callPath))
  .use(body(toolRequestSchema))
  .handle(
    ({ services, caller, path, body }): Promise<ToolResponse> =>
      services.calls.tool(caller, path.id, {
        toolCallId: body.toolCallId,
        name: body.name,
        args: body.arguments,
        saying: body.saying,
        hearing: body.hearing,
      }),
  );
