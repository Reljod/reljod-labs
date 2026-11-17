import "server-only";
import { after } from "next/server";
import type { Owner } from "@/features/access/domain/owner";
import { SEED_STAFF } from "../domain/staff";
import { sql } from "./db";
import { backfillKnowledge, seedKnowledge } from "./seed/knowledge";
import { seedRecords } from "./seed/records";

/**
 * The seed a Workspace should hold. Raise it when `SEED_STAFF`, `seedRecords`
 * or `seedKnowledge` grows; Workspaces on an older number are topped up the
 * next time they are opened. The number only decides whether to run the
 * seeders: each of them adds only what is missing (by Staff key, Employer
 * code, Member number, seed Source key), so a fresh Workspace gets everything
 * once and a top-up never duplicates.
 */
export const SEED_VERSION = 1;

/** Owners this function instance has already seen seeded, to skip the check. */
const seeded = new Set<Owner>();

/** Forget that an Owner was seeded: their Workspace turned out to be gone. */
export function forgetWorkspace(owner: Owner) {
  seeded.delete(owner);
}

/**
 * Makes sure the Owner's Workspace exists and holds the current seed: the
 * Workspace row, the seed Staff, then the records and the Knowledge base.
 * Safe to call on every request and from several at once: the row is created
 * with `on conflict do nothing`, then locked, and the seed runs in that one
 * transaction, so a second caller waits and finds it done.
 */
export async function ensureWorkspace(owner: Owner): Promise<void> {
  if (seeded.has(owner)) return;
  const [existing] = await sql()<{ seed_version: number }[]>`
    select seed_version from harness.workspaces where owner = ${owner}`;
  if (existing && existing.seed_version >= SEED_VERSION) {
    seeded.add(owner);
    return;
  }

  const ran = await sql().begin(async (tx) => {
    await tx`
      insert into harness.workspaces (owner) values (${owner})
      on conflict (owner) do nothing`;
    const [row] = await tx<{ seed_version: number }[]>`
      select seed_version from harness.workspaces
      where owner = ${owner} for update`;
    const from = row?.seed_version ?? 0;
    if (from >= SEED_VERSION) return false;

    for (const member of SEED_STAFF) {
      await tx`
        insert into harness.staff (owner, key, name, title, role, initials)
        values (${owner}, ${member.key}, ${member.name}, ${member.title},
                ${member.role}, ${member.initials})
        on conflict (owner, key) do nothing`;
    }
    await seedRecords(tx, owner);
    await seedKnowledge(tx, owner);
    await tx`
      update harness.workspaces
      set seed_version = ${SEED_VERSION}, seeded_at = coalesce(seeded_at, now())
      where owner = ${owner}`;
    return true;
  });
  seeded.add(owner);

  if (ran) {
    const backfill = () =>
      backfillKnowledge(owner).catch((error) => {
        console.error("[harness] could not embed the seed Passages", error);
      });
    try {
      // Model calls stay out of the seed transaction and off the response.
      after(backfill);
    } catch {
      // Not in a request (a script, a workflow step): run it now, unawaited.
      void backfill();
    }
  }
}
