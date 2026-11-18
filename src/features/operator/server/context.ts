import type { Driver, ModelId, RunMetrics } from "../domain/contract";
import { EMPTY_METRICS } from "../domain/contract";
import type { ManifestRow } from "../domain/manifest";
import type { Rulebook } from "../domain/rules";
import { ownFixture } from "../domain/task-cards";
import { sampleTask } from "../domain/tasks";
import type { Fixture } from "../legacy/types";
import { type RunRow, metricsOf, runRulebook } from "./repository";

/**
 * What a Run's steps need to know, small and plain so it crosses workflow
 * step boundaries. The sample Task's Fixture, Expectations and Script are
 * looked up from `taskId` where they are used, never carried.
 */
export type RunContext = {
  runId: string;
  driver: Driver;
  taskId: string | null;
  title: string;
  brief: string;
  model: ModelId | null;
  /** The scripted Operator: plays the sample Task's Script, no model call. */
  stubbed: boolean;
  rulebook: Rulebook;
  rulebookVersion: number;
  /** The harness's secret for the Screen sandbox's control port. */
  secret: string;
  manifest: {
    name: string;
    text: string;
    voyage?: string;
    lines: ManifestRow[];
  } | null;
};

/** A Run's running totals: its metrics and what it has spent. */
export type Counters = RunMetrics & { costUsd: number };

export const emptyCounters = (): Counters => ({ ...EMPTY_METRICS, costUsd: 0 });

export const countersOf = (row: RunRow): Counters => ({
  ...metricsOf(row),
  costUsd: Number(row.cost_usd),
});

export function metricsFrom(counters: Counters): RunMetrics {
  const { costUsd: _costUsd, ...metrics } = counters;
  return metrics;
}

/** The Fixture a Run starts from: the sample Task's, or the port's Books for an own Task. */
export function fixtureOf(taskId: string | null): Fixture {
  return (taskId ? sampleTask(taskId)?.fixture : undefined) ?? ownFixture();
}

/** The sample Task's Expectations; null for an own Task. */
export const expectedOf = (taskId: string | null) =>
  (taskId ? sampleTask(taskId)?.expected : undefined) ?? null;

/** The context of a Run already on its row, for a driver that comes back to it (an MCP client). */
export function contextOf(
  row: RunRow,
  manifest: RunContext["manifest"],
): RunContext {
  return {
    runId: row.id,
    driver: row.driver,
    taskId: row.task_id,
    title: row.title,
    brief: row.brief,
    model: row.model,
    stubbed: row.stubbed,
    rulebook: runRulebook(row),
    rulebookVersion: row.rulebook_version,
    secret: row.screen_secret ?? "",
    manifest,
  };
}
