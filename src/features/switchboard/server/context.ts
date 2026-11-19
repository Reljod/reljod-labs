import "server-only";
import { requireOwner } from "@/features/access/server/gate";
import { visitor } from "./rate";
import { ensureWorkspace } from "./store";

/**
 * What every Switchboard entry point calls first: it passes the Access gate
 * (the second of the two, after the proxy), makes the Owner's Workspace with
 * its Back office on first use, and names who is spending.
 */
export async function requireWorkspace() {
  const [{ access, owner }, who] = await Promise.all([
    requireOwner(),
    visitor(),
  ]);
  await ensureWorkspace(owner);
  return { access, owner, who };
}
