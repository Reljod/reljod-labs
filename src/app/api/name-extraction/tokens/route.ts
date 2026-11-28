import type { TokenResponse } from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";

/**
 * Mints a bearer token for an outside MCP client to act for this Owner on
 * /api/name-extraction/mcp. Shown once, never stored.
 */
export const POST = sieveApi.handle(
  ({ services, access, owner, visitor }): Promise<TokenResponse> =>
    services.connect.mint({ access, owner, visitor }),
);
