import { EMPTY_METRICS, type RunMetrics } from "../domain/contract";

/**
 * A Run's running totals: its metrics and what it has spent. Pure, with no
 * server imports, because the workflow function itself uses it.
 */
export type Counters = RunMetrics & { costUsd: number };

export const emptyCounters = (): Counters => ({ ...EMPTY_METRICS, costUsd: 0 });

export function metricsFrom(counters: Counters): RunMetrics {
  const { costUsd: _costUsd, ...metrics } = counters;
  return metrics;
}
