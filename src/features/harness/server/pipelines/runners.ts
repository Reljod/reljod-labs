import "server-only";
import type { PipelineId } from "../../domain/pipeline";
import { CONTRIBUTION_RUNNER } from "./contribution";
import { DELINQUENCY_RUNNER } from "./delinquency";
import { MEMBER_REQUEST_RUNNER } from "./member-request";
import type { PipelineRunner } from "./types";

/** Each Pipeline's server half, by id. */
export const RUNNERS: Record<PipelineId, PipelineRunner> = {
  member_request: MEMBER_REQUEST_RUNNER,
  contribution_processing: CONTRIBUTION_RUNNER,
  delinquency_report: DELINQUENCY_RUNNER,
};
