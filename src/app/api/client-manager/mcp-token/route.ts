import { clientManagerApi } from "@/features/client-manager/server/api";

/** Mints this visitor's MCP token to paste: a Guest's lasts as long as their pass. */
export const POST = clientManagerApi.handle(
  ({ services, access, owner, visitor }) =>
    services.connect.mint({ access, owner, visitor }),
);
