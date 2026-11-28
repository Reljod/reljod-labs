import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { db } from "@/server/postgres";
import type { WorkspaceRepository } from "./ports";

const known = new Set<string>();

/** The Owner's Workspace row, which everything they save hangs off. */
export const workspaceRepository: WorkspaceRepository = {
  async ensure(owner: Owner) {
    if (known.has(owner)) return;
    await db()`
      insert into canvas.workspaces (owner) values (${owner})
      on conflict (owner) do nothing`;
    // A purged Owner would need the row again; the set only saves a round trip per instance.
    if (known.size > 500) known.clear();
    known.add(owner);
  },
};
