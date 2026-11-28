import { hostApi } from "@/features/access/server/api";

/** "Disconnect all MCP clients": every MCP token the Host was issued is refused from now on. */
export const DELETE = hostApi.handle(({ services, access }) =>
  services.mcpClients.disconnectAll(access),
);
