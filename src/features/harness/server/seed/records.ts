import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Db } from "../db";

/**
 * Owned by the Pipelines slice. Seeds a new Workspace's records: Employers,
 * Members, Schedules, Remittances and Member requests of the fictional
 * Harbour Bank & Trust pension plan.
 *
 * Called by `ensureWorkspace` inside the transaction that holds the
 * Workspace's row lock, so it must be quick and must not call a model.
 * `fromVersion` is the seed the Workspace already holds (0 for a new one):
 * insert only what later versions added, and make every insert safe to run
 * twice (`on conflict do nothing` on `(owner, code)`, `(owner, member_no)`).
 * Raise `SEED_VERSION` in `workspace.ts` when the seed grows.
 */
export async function seedRecords(
  _tx: Db,
  _owner: Owner,
  _fromVersion: number,
): Promise<void> {}
