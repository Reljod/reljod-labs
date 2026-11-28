import type { TokenResponse } from "@/features/loupe/domain/api";
import { loupeApi } from "@/features/loupe/server/api";

/**
 * Mints a bearer token for an outside MCP client to act for this Owner on
 * /api/loupe/mcp. Shown once, never stored; capped per Owner per day.
 */
export const POST = loupeApi.handle(
  ({ services, access, owner, visitor }): Promise<TokenResponse> =>
    services.connect.mint({ access, owner, visitor }),
);
