import { getPublicOrigin } from "mcp-handler";
import { bankApi } from "@/features/bank/server/api";

/** A token for an outside MCP client, acting as the Staff member signed in now. */
export const POST = bankApi.handle(({ services, context, request }) =>
  services.staff.connect(context, getPublicOrigin(request)),
);
