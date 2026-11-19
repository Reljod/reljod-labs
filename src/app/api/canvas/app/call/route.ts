import { getPublicOrigin } from "mcp-handler";
import { z } from "zod";
import { requireCallerAccess } from "@/features/canvas/server/caller";
import { callFromApp } from "@/features/canvas/server/host";
import { bodyOf, failure, json } from "@/features/canvas/server/respond";

// One Query in the Sandbox, plus a cold Sandbox start.
export const maxDuration = 120;

const bodySchema = z.object({
  name: z.string().min(1).max(60),
  arguments: z.record(z.string(), z.unknown()).default({}),
  conversationId: z.string().uuid().optional(),
});

/**
 * An App's `tools/call`, proxied by the page's Host to the MCP server: a
 * Control changed, so the View's saved Query runs again. No model is
 * called. Answers the CallToolResult as the MCP server gave it.
 */
export async function POST(request: Request) {
  try {
    const { caller, access } = await requireCallerAccess();
    const body = bodySchema.parse(await bodyOf(request));
    const result = await callFromApp(
      access,
      { ...caller, conversationId: body.conversationId },
      getPublicOrigin(request),
      { name: body.name, arguments: body.arguments },
    );
    return json(result);
  } catch (error) {
    return failure(error);
  }
}
