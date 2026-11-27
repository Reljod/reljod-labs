import { getPublicOrigin } from "mcp-handler";
import type { McpTokenResponse } from "@/features/harness/domain/api";
import { harnessApi, permits } from "@/features/harness/server/api";
import { authorize } from "@/platform/http/middleware";

/**
 * A token to paste into an MCP client that cannot sign in with OAuth. It acts
 * as the Staff member signed in now and lasts as long as the visitor's
 * Access (a Guest's ends with their pass). Writes `mcp.connected`.
 */
export const POST = harnessApi.use(authorize(permits("mcp.connect"))).handle(
  ({ services, caller, request }): Promise<McpTokenResponse> =>
    // The public address, as the OAuth metadata gives it.
    services.connect.mintToken(caller, getPublicOrigin(request)),
);
