import { requirePermission } from "@/features/harness/server/context";
import { mintPastedToken } from "@/features/harness/server/mcp-auth";
import { originOf } from "@/features/harness/server/oauth-http";
import { failure, json } from "@/features/harness/server/respond";

/**
 * A token to paste into an MCP client that cannot sign in with OAuth. It acts
 * as the Staff member signed in now and lasts as long as the visitor's
 * Access (a Guest's ends with their pass). Writes `mcp.connected`.
 */
export async function POST(request: Request) {
  try {
    const context = await requirePermission("mcp.connect");
    return json(await mintPastedToken(context, originOf(request)));
  } catch (error) {
    return failure(error);
  }
}
