import type { Owner } from "@/features/access/domain/owner";
import type {
  DocumentFormat,
  DocumentKind,
  DocumentSource,
  DoneGate,
  Driver,
  ExaminationStatus,
  ExaminationSummary,
  Finding,
  Hypothesis,
  Measurement,
  PageInfo,
  Review,
  Score,
  SkillId,
  StopReason,
  TrailEventInput,
  VerdictResult,
} from "../domain/contract";
import { decide, doneGate, evaluate } from "../domain/evaluate";
import type { Rulebook } from "../domain/rules";

/*
 * An Examination as the services see it: its row, its working state and
 * what stands under its Rulebook. Pure, so the services and their tests use
 * it without a database.
 */

export type ExaminationState = {
  measurements: Measurement[];
  hypotheses: Hypothesis[];
  /** The Examiner's reviews of Sweep Findings, by Measurement id. */
  reviews: Record<string, Review>;
  /** Pages the Examiner looked at. */
  looked: number[];
  skills: SkillId[];
  counters: {
    turns: number;
    codeRuns: number;
    checkRuns: number;
    looks: number;
    /** The next "m<n>" Measurement id. */
    nextMeasurement: number;
  };
  /** How the Sweep's Measurements were taken. */
  sweepMode: "live" | "recorded" | null;
  driver: Driver;
  /** Where the request that started it came in, for a Sample's file. */
  origin: string;
  /**
   * Started by the stubbed e2e suite: its workflow steps and its Examiner's
   * tool calls run on the stubbed container (scripted Examiner, recorded
   * Sandbox), whatever request later reaches it.
   */
  stub: boolean;
  /** Set by `finish` once the Done gate passed. */
  finished: { summary: string } | null;
};

export function emptyState(
  init: Partial<Pick<ExaminationState, "driver" | "origin" | "stub">> = {},
): ExaminationState {
  return {
    driver: init.driver ?? "examiner",
    origin: init.origin ?? "",
    stub: init.stub ?? false,
    finished: null,
    measurements: [],
    hypotheses: [],
    reviews: {},
    looked: [],
    skills: [],
    counters: {
      turns: 0,
      codeRuns: 0,
      checkRuns: 0,
      looks: 0,
      nextMeasurement: 1,
    },
    sweepMode: null,
  };
}

export type ExaminationRow = {
  id: string;
  owner: Owner;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  source: DocumentSource;
  is_forgery: boolean;
  status: ExaminationStatus;
  model: string;
  examiner: boolean;
  rulebook_version: number;
  rulebook: Rulebook;
  workflow_run_id: string | null;
  cost_usd: number;
  pages: PageInfo[];
  state: ExaminationState;
  findings: Finding[];
  verdict: VerdictResult | null;
  score: Score | null;
  gate: DoneGate | null;
  stopped_by: StopReason | null;
  error: string | null;
  visitor_hash: string;
  via: "app" | "mcp";
  started_at: string;
  ended_at: string | null;
};

/** The few columns a stream poll or a tool call's token needs, without the state. */
export type ExaminationPulse = Pick<
  ExaminationRow,
  | "id"
  | "owner"
  | "status"
  | "started_at"
  | "visitor_hash"
  | "verdict"
  | "error"
> & {
  driver: Driver;
  pageCount: number;
  stub: boolean;
  origin: string;
};

/** The columns a service may change, outside the state. */
export type ExaminationPatch = Partial<{
  status: ExaminationStatus;
  workflow_run_id: string;
  cost_usd: number;
  kind: DocumentKind;
  pages: PageInfo[];
  findings: Finding[];
  verdict: VerdictResult | null;
  score: Score | null;
  gate: DoneGate | null;
  stopped_by: StopReason | null;
  error: string | null;
  rulebook_version: number;
  rulebook: Rulebook;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check an id from a URL, a tool call or a token before it reaches a `uuid` column or a Storage key. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isOver(status: ExaminationStatus | null) {
  return status !== "queued" && status !== "running";
}

export function toSummary(row: ExaminationRow): ExaminationSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    format: row.format,
    source: row.source,
    forgery: row.is_forgery,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    model: row.model,
    driver: row.state.driver,
    rulebookVersion: row.rulebook_version,
    costUsd: row.cost_usd,
    verdict: row.verdict?.verdict ?? null,
    findings: row.findings.filter((finding) => finding.weight !== "context")
      .length,
    score: row.score,
    gatePassed: row.gate?.passed ?? null,
    stoppedBy: row.stopped_by,
    error: row.error,
  };
}

// What stands after a change ----------------------------------------------------------

export type Standing = {
  findings: Finding[];
  verdict: VerdictResult;
  gate: DoneGate;
};

/** The Findings, Verdict and Done gate of a state under the Examination's Rulebook. */
export function standingOf(
  row: Pick<ExaminationRow, "kind" | "rulebook" | "pages">,
  state: ExaminationState,
): Standing {
  const findings = evaluate({
    measurements: state.measurements,
    hypotheses: state.hypotheses,
    reviews: state.reviews,
    kind: row.kind,
    rulebook: row.rulebook,
  });
  return {
    findings,
    verdict: decide(findings, row.rulebook),
    gate: doneGate({
      pagesTotal: row.pages.length,
      pagesLooked: state.looked,
      findings,
      hypotheses: state.hypotheses,
    }),
  };
}

export const standingPatch = (standing: Standing) => ({
  findings: standing.findings,
  verdict: standing.verdict,
  gate: standing.gate,
});

export function standingEvents(
  row: Pick<ExaminationRow, "rulebook_version">,
  standing: Standing,
): TrailEventInput[] {
  return [
    {
      type: "findings",
      findings: standing.findings,
      verdict: standing.verdict,
      rulebookVersion: row.rulebook_version,
    },
    { type: "gate", gate: standing.gate },
  ];
}
