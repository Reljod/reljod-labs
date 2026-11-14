import { mintMcpToken } from "@/features/client-manager/server/mcp-auth";
import { failure } from "../respond";

/** Mints this visitor's MCP token: a Guest's lasts as long as their pass. */
export async function POST() {
  try {
    return Response.json(await mintMcpToken(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
