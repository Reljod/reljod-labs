import type { TokenResponse } from "@/features/canvas/domain/api";
import { canvasApi } from "@/features/canvas/server/api";

/**
 * A token for an outside MCP client (Claude) to act for this Owner, on the
 * Trail before it is handed over. It is shown once and ends with the
 * person's Access.
 */
export const POST = canvasApi.handle(
  ({ services, access, caller }): Promise<TokenResponse> =>
    services.connect.mint(access, caller),
);
