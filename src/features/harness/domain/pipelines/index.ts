import type { PipelineId, PipelineSpec } from "../pipeline";
import { MEMBER_REQUEST_LABEL, type MemberRequestKind } from "../records";
import { CONTRIBUTION_PROCESSING } from "./contribution-processing";
import { formatPeriod, isPeriod } from "./dates";
import { DELINQUENCY_REPORT } from "./delinquency-report";
import { MEMBER_REQUEST } from "./member-request";

/**
 * The three Pipelines of the Pensions Operations Desk, with their checks as
 * pure functions beside them in `checks/` (ADR 0015).
 */
export const PIPELINES: PipelineSpec[] = [
  MEMBER_REQUEST,
  CONTRIBUTION_PROCESSING,
  DELINQUENCY_REPORT,
];

export function pipelineOf(id: string): PipelineSpec | null {
  return PIPELINES.find((pipeline) => pipeline.id === id) ?? null;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * One line on what a Run is about, from its input and, once it has ended,
 * its result: "Transfer out · HB-10012", "ER-1001 · October 2026".
 */
export function subjectOf(
  pipelineId: PipelineId,
  input: Record<string, unknown>,
  result: Record<string, unknown> | null,
): string {
  if (pipelineId === "member_request") {
    const kind = text(result?.kind) as MemberRequestKind | null;
    const label =
      kind && kind in MEMBER_REQUEST_LABEL
        ? MEMBER_REQUEST_LABEL[kind]
        : "Member request";
    const memberNo = text(result?.memberNo) ?? text(input.memberNo);
    if (memberNo) return `${label} · ${memberNo}`;
    const papers = Array.isArray(input.sourceIds) ? input.sourceIds.length : 0;
    return `${label} · ${papers} paper${papers === 1 ? "" : "s"}`;
  }
  if (pipelineId === "contribution_processing") {
    const employer =
      text(result?.employerCode) ?? text(input.employerCode) ?? "Schedule";
    const period = text(result?.period) ?? text(input.period);
    return period && isPeriod(period)
      ? `${employer} · ${formatPeriod(period)}`
      : employer;
  }
  const period = text(input.period);
  return `Delinquency · ${period && isPeriod(period) ? formatPeriod(period) : "month"}`;
}
