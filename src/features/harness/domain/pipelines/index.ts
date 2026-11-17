import type { PipelineSpec } from "../pipeline";

/**
 * Owned by the Pipelines slice. The three Pipelines of the Pensions
 * Operations Desk (`member_request`, `contribution_processing`,
 * `delinquency_report`) are declared here, with their checks as pure
 * functions beside them (ADR 0015). Empty until that slice lands.
 */
export const PIPELINES: PipelineSpec[] = [];

export function pipelineOf(id: string): PipelineSpec | null {
  return PIPELINES.find((pipeline) => pipeline.id === id) ?? null;
}
