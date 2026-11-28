"use client";

import { useState } from "react";
import { disconnectMcpClients } from "./api";
import { ConfirmDialog } from "./pass-actions";
import { quietButtonClass } from "./styles";

/**
 * A Host's "Disconnect all MCP clients", asked first in a dialog: it cannot
 * be undone, and every client they connected has to sign in again.
 */
export function DisconnectMcpClients() {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  return (
    <>
      <button
        type="button"
        className={`${quietButtonClass} self-start hover:text-seal-red`}
        onClick={() => {
          setOpened((count) => count + 1);
          setOpen(true);
        }}
      >
        Disconnect all MCP clients
      </button>
      {open ? (
        <ConfirmDialog
          key={opened}
          id="disconnect-mcp-clients"
          title="Disconnect all MCP clients"
          write={() => disconnectMcpClients()}
          confirm="Disconnect all"
          pending="Disconnecting…"
          danger
          onClose={() => setOpen(false)}
        >
          Every MCP client you connected to the Client Manager or the Harness
          (by signing in, or with a pasted token) stops working now and has to
          sign in again. Guests' connections end with their pass, not here.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
