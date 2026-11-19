import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { sql } from "./db";

const known = new Set<string>();

/** Makes the Owner's Workspace row, which everything they save hangs off. Idempotent. */
export async function ensureWorkspace(owner: Owner) {
  if (known.has(owner)) return;
  await sql()`
    insert into canvas.workspaces (owner) values (${owner})
    on conflict (owner) do nothing`;
  // A purged Owner would need the row again; the set only saves a round trip per instance.
  if (known.size > 500) known.clear();
  known.add(owner);
}

/** Forget a Workspace this instance believed in: its insert was refused by a foreign key. */
export function forgetWorkspace(owner: Owner) {
  known.delete(owner);
}
