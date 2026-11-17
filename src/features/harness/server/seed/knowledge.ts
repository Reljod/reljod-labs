import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Db } from "../db";

/**
 * Owned by the Knowledge slice. Seeds a new Workspace's Knowledge base: the
 * seed Sources (`is_seed`) and their Passages.
 *
 * Called by `ensureWorkspace` inside the transaction that holds the
 * Workspace's row lock, so it must be quick and must NOT call a model: insert
 * Passages with `embedding` null here (full-text search already finds them)
 * and embed them in `backfillKnowledge`. `fromVersion` is the seed the
 * Workspace already holds (0 for a new one); make every insert safe to run
 * twice.
 */
export async function seedKnowledge(
  _tx: Db,
  _owner: Owner,
  _fromVersion: number,
): Promise<void> {}

/**
 * Owned by the Knowledge slice. Embeds the seed Passages that have no
 * embedding yet. `ensureWorkspace` schedules it after the response, once the
 * seed has committed; it may run more than once, so it must be idempotent
 * and may give up quietly (the next request that seeds will not retry it, so
 * `searchKnowledge` should also call it when it meets Passages without one).
 */
export async function backfillKnowledge(_owner: Owner): Promise<void> {}
