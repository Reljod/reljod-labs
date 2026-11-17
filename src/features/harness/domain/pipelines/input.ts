import { z } from "zod";
import { LIMITS } from "../limits";
import type { PipelineId } from "../pipeline";
import { MEMBER_REQUEST_KINDS } from "../records";
import { addPeriods, isPeriod, periodOf } from "./dates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = z.string().trim().regex(UUID, "A Source id is a UUID.");

/** A list of ids, given as a list or as one string with commas or spaces. */
const idList = z.preprocess(
  (value) =>
    typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : value,
  z
    .array(id)
    .min(1, "Attach at least one paper.")
    .max(
      LIMITS.sourcesPerRun,
      `A Run reads at most ${LIMITS.sourcesPerRun} papers.`,
    ),
);

const period = z.string().trim().refine(isPeriod, "Give the month as YYYY-MM.");

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const flag = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean().optional(),
);

export const MEMBER_REQUEST_INPUT = z.object({
  sourceIds: idList.transform((ids) => [
    ...new Set(ids.map((value) => value.toLowerCase())),
  ]),
  memberNo: optionalText(20),
  kind: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.enum(MEMBER_REQUEST_KINDS).optional(),
  ),
  note: optionalText(500),
});

export const CONTRIBUTION_INPUT = z.object({
  sourceId: id.transform((value) => value.toLowerCase()),
  employerCode: optionalText(20).transform((value) => value?.toUpperCase()),
  period: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    period.optional(),
  ),
  overrideExceptions: flag,
});

export const DELINQUENCY_INPUT = z.object({ period });

export type MemberRequestInput = z.infer<typeof MEMBER_REQUEST_INPUT>;
export type ContributionInput = z.infer<typeof CONTRIBUTION_INPUT>;
export type DelinquencyInput = z.infer<typeof DELINQUENCY_INPUT>;

export type ParsedInput =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Checks a Run's input against its Pipeline and returns it cleaned. `asOf`
 * is today: a delinquency report is only for a month that has ended.
 */
export function parseRunInput(
  pipelineId: PipelineId,
  raw: unknown,
  asOf: string,
): ParsedInput {
  const schema =
    pipelineId === "member_request"
      ? MEMBER_REQUEST_INPUT
      : pipelineId === "contribution_processing"
        ? CONTRIBUTION_INPUT
        : DELINQUENCY_INPUT;
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    return {
      ok: false,
      message: `${field ? `${field}: ` : ""}${issue?.message ?? "That input doesn't look right."}`,
    };
  }
  const input = result.data as Record<string, unknown>;
  const month = input.period;
  if (typeof month === "string" && month >= periodOf(asOf)) {
    return {
      ok: false,
      message: `period: ${month} has not ended yet. The latest month is ${addPeriods(periodOf(asOf), -1)}.`,
    };
  }
  return {
    ok: true,
    input: Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ),
  };
}

/** The Sources a Run's input names, so the server can check they are the Owner's. */
export function sourceIdsOf(input: Record<string, unknown>): string[] {
  if (Array.isArray(input.sourceIds)) return input.sourceIds as string[];
  if (typeof input.sourceId === "string") return [input.sourceId];
  return [];
}
