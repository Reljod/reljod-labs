import "server-only";
import type { Done } from "../../domain/api";
import { ownerOf } from "../../domain/owner";
import type { Access } from "../gate";
import type { AccessPorts } from "../ports";
import { asHost } from "./common";

/** The MCP clients a Host connected to the Client Manager and the Harness. */
export interface McpClientService {
  /**
   * "Disconnect all MCP clients": every MCP token the Host was issued (OAuth
   * sign-ins, their refresh tokens, pasted tokens) is refused from now on.
   * Guests have no such button: their tokens end with their Guest pass.
   */
  disconnectAll(access: Access | null): Promise<Done>;
}

export function createMcpClientService(
  ports: Pick<AccessPorts, "tokens">,
): McpClientService {
  return {
    async disconnectAll(access) {
      await ports.tokens.disconnectAll(ownerOf(asHost(access)));
      return {
        done: "Disconnected. Every MCP client you connected must sign in again.",
      };
    },
  };
}
