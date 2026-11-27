"use server";

import { ownerOf } from "../domain/owner";
import { AccessDeniedError, requireHost } from "./gate";
import { disconnectMcpClientsOf } from "./mcp-tokens";

export type DisconnectState = { error: string } | { done: string } | null;

/**
 * A Host's "Disconnect all MCP clients": every MCP token they were issued
 * for the Client Manager and the Harness (OAuth sign-ins, their refresh
 * tokens and pasted tokens) is refused from now on.
 */
export async function disconnectMcpClients(
  _previous: DisconnectState,
  _form: FormData,
): Promise<DisconnectState> {
  let owner: ReturnType<typeof ownerOf>;
  try {
    owner = ownerOf(await requireHost());
  } catch (error) {
    if (error instanceof AccessDeniedError)
      return { error: "Only a signed-in Host can do this. Sign in again." };
    throw error;
  }
  try {
    await disconnectMcpClientsOf(owner);
  } catch (error) {
    console.error("Disconnect all MCP clients failed", error);
    return { error: "Could not disconnect them. Try again." };
  }
  return {
    done: "Disconnected. Every MCP client you connected must sign in again.",
  };
}
