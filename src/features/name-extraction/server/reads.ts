import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  ExtractedName,
  RulebookVersion,
  RunDetail,
  RunSummary,
} from "../domain/contract";
import {
  allEvents,
  isOver,
  ownedRun,
  rulebookVersions,
  runsOf,
  toSummary,
} from "./repository";
import { closeIfStale } from "./runs";

/*
 * Sieve's reads, for the GET routes (domain/api.ts) and the page's first
 * render. Each takes the Owner its caller got from the Access gate and reads
 * only what is theirs (ADR 0011).
 */

/** The Owner's Runs, newest first. */
export async function runsFor(owner: Owner): Promise<RunSummary[]> {
  const rows = await runsOf(owner, 50);
  return (await Promise.all(rows.map(closeIfStale))).map(toSummary);
}

/** One of the Owner's Runs with its Audit trail and its Register. */
export async function runDetail(
  owner: Owner,
  runId: string,
): Promise<RunDetail | null> {
  const found = await ownedRun(owner, runId);
  if (!found) return null;
  const run = await closeIfStale(found);
  const events = await allEvents(run.id);
  let names: ExtractedName[] = Array.isArray(run.names) ? run.names : [];
  if (!isOver(run.status) || names.length === 0) {
    // While a Run goes, the Register is its latest `names` event.
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.type === "names") {
        names = event.names;
        break;
      }
    }
  }
  // The detail carries the list in place of the summary's count.
  const { names: _count, ...summary } = toSummary(run);
  return { ...summary, events, names };
}

/** What the page's first view needs, read together; a part that fails is null. */
export async function initialView(owner: Owner): Promise<{
  runs: RunSummary[] | null;
  rulebooks: RulebookVersion[] | null;
}> {
  const [runs, rulebooks] = await Promise.allSettled([
    runsFor(owner),
    rulebookVersions(owner),
  ]);
  return {
    runs: runs.status === "fulfilled" ? runs.value : null,
    rulebooks: rulebooks.status === "fulfilled" ? rulebooks.value : null,
  };
}
