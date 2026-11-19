import { z } from "zod";
import type { ToolResponse } from "@/features/switchboard/domain/api";
import { LIMITS } from "@/features/switchboard/domain/limits";
import { callTool } from "@/features/switchboard/server/calls";
import { requireWorkspace } from "@/features/switchboard/server/context";
import { bodyOf, failure, json } from "@/features/switchboard/server/respond";

const schema = z.object({
  toolCallId: z.string().min(1).max(120),
  name: z.string().min(1).max(60),
  arguments: z.string().max(8000),
  saying: z
    .string()
    .max(LIMITS.transcriptChars * 2)
    .optional(),
  hearing: z
    .string()
    .max(LIMITS.transcriptChars * 2)
    .optional(),
});

/**
 * The voice Session's tool bridge: the realtime model asked for a tool, the
 * browser passes the call here, and the Back office (not the browser, not
 * the model) decides. The same `callTool` the MCP server and the text Line use.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/switchboard/calls/[id]/tools">,
) {
  try {
    const { owner, who } = await requireWorkspace();
    const { id } = await params;
    const body = schema.parse(await bodyOf(request));
    let args: unknown = {};
    try {
      args = body.arguments ? JSON.parse(body.arguments) : {};
    } catch {
      args = null;
    }
    return json<ToolResponse>(
      await callTool({
        owner,
        who,
        callId: id,
        toolCallId: body.toolCallId,
        name: body.name,
        args,
        saying: body.saying,
        hearing: body.hearing,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
