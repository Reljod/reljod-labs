import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  RulebookVersion,
  RunDetail,
  RunSummary,
} from "../domain/contract";
import { expectedOf } from "./context";
import {
  allEvents,
  ownedRun,
  rulebookVersions,
  runRulebook,
  runsOf,
  toSummary,
} from "./repository";
import { closeIfStale } from "./runs";

/*
 * The Operator's reads, for the GET routes (domain/api.ts), the MCP tools
 * and the page's first render. Each takes the Owner its caller got from the
 * Access gate and reads only what is theirs (ADR 0011).
 */

/** The Owner's Runs, newest first. */
export async function runsFor(owner: Owner): Promise<RunSummary[]> {
  const rows = await runsOf(owner, 40);
  return (await Promise.all(rows.map(closeIfStale))).map(toSummary);
}

/** One of the Owner's Runs with its Trail and Findings. */
export async function runDetail(
  owner: Owner,
  runId: string,
): Promise<RunDetail | null> {
  const found = await ownedRun(owner, runId);
  if (!found) return null;
  const run = await closeIfStale(found);
  const events = await allEvents(run.id);
  return {
    ...toSummary(run),
    events,
    findings: Array.isArray(run.findings) ? run.findings : [],
    expected: (expectedOf(run.task_id) ?? []).map((item) => item.label),
    rulebook: runRulebook(run),
  };
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
