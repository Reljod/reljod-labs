import type { TokenResponse } from "@/features/switchboard/domain/api";
import { switchboardApi } from "@/features/switchboard/server/api";

/**
 * Mints the token an outside MCP client presents on /api/switchboard/mcp.
 * Signed, not stored: the answer is the only time it is shown.
 */
export const POST = switchboardApi.handle(
  ({ services, access, owner, visitor }): Promise<TokenResponse> =>
    services.connect.mint(access, owner, visitor),
);
