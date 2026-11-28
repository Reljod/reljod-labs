import type { Owner } from "@/features/access/domain/owner";
import type { DeckPlan } from "../domain/deck";
import type { ModelCall, ModelChoice } from "../domain/models";
import type { Process, Watch } from "../domain/process";
import type {
  CheckResult,
  ReviewFinding,
  Rule,
  RuleSet,
} from "../domain/rules";
import type {
  AuditEvent,
  DeckRound,
  RunEvent,
  RunEventInput,
  RunPatch,
  RunStatus,
  RunSummary,
  StageState,
} from "../domain/run";
import type { AuditInput } from "./audit";
import type { RunContext } from "./llm";
import type { ActiveRun, RunRow, SettingsRow } from "./run-row";
import type { PipelineInput } from "./run-workflow";

/*
 * What Handover's services need from the outside world. The containers
 * (`container.ts` for requests, `pipeline-container.ts` for the workflow's
 * steps) wire the real adapters; unit tests hand in fakes, and the stubbed
 * e2e suite gets the scripted Analyst instead of the models.
 */

export type RecordingSource =
  | { kind: "sample"; slug: string }
  | { kind: "upload"; path: string; name: string; type: string };

/** The Runs table, every read by id scoped to an Owner (the pipeline's own reads aside). */
export interface RunRepository {
  create(input: {
    owner: Owner;
    visitorHash: string;
    source: RecordingSource;
    title: string;
    stages: StageState[];
    rules: Rule[];
    rulesVersion: number;
    models: ModelChoice;
  }): Promise<string>;
  owned(owner: Owner, id: string): Promise<RunRow | null>;
  /** The Run and its model calls, in one read. */
  ownedWithCalls(
    owner: Owner,
    id: string,
  ): Promise<{ row: RunRow; calls: ModelCall[] } | null>;
  list(owner: Owner): Promise<RunSummary[]>;
  active(owner: Owner): Promise<ActiveRun[]>;
  /** USD the Owner spent today, and the Runs and Redos started (by the visitor this hour, by everyone today). */
  workTotals(
    owner: Owner,
    visitorHash: string,
  ): Promise<{
    ownerSpentToday: number;
    visitorStartsLastHour: number;
    startsToday: number;
  }>;
  /** Ends a Run that is still going; the row as it now is, or null when it was not going. */
  markStopped(
    id: string,
    owner: Owner,
    reason?: string,
    status?: "stopped" | "failed",
  ): Promise<RunRow | null>;
  /** The new generation, or null when the Run did not qualify for a Redo. */
  resetForRedo(input: {
    id: string;
    owner: Owner;
    stages: StageState[];
    rules: Rule[];
    rulesVersion: number;
    models: ModelChoice;
  }): Promise<number | null>;
  setFields(
    id: string,
    fields: Partial<{
      workflow_run_id: string | null;
      status: RunStatus;
      error: string | null;
      completed_at: Date | null;
    }>,
  ): Promise<void>;
  /** The unique index that keeps one active Run per Owner refused the write. */
  isActiveRunConflict(error: unknown): boolean;
}

/** An Owner's Rule overrides and models (`process_transfer.settings`). */
export interface SettingsRepository {
  of(owner: Owner): Promise<SettingsRow | null>;
  save(
    owner: Owner,
    input: { ruleOverrides?: unknown; models?: unknown },
  ): Promise<SettingsRow>;
  /** Edits the overrides with the row locked, so two saves at once both stand. */
  editRuleOverrides(
    owner: Owner,
    edit: (current: unknown) => unknown,
  ): Promise<{ before: SettingsRow; after: SettingsRow }>;
}

/** The append-only Audit trail. */
export interface AuditLog {
  /** A line a person's action writes; a failure fails the action. */
  person(input: AuditInput): Promise<void>;
  /** A line the pipeline writes; it never fails the work it describes. */
  pipeline(input: AuditInput): Promise<void>;
  list(
    owner: Owner,
    options: { before?: number; runId?: string; limit: number },
  ): Promise<AuditEvent[]>;
}

/** The private `process-transfer` bucket, under `recordings/<owner>/`. */
export interface RecordingStore {
  uploadUrl(path: string): Promise<string>;
  /** The stored object's size, or null when there is none. */
  objectSize(path: string): Promise<number | null>;
  /** A URL the browser can play a private Recording from, or null. */
  signedUrl(path: string): Promise<string | null>;
  /** Objects stored under a folder since a time. */
  uploadsSince(prefix: string, since: Date): Promise<number>;
}

/** The durable workflow a Run's pipeline runs in. */
export interface RunWorkflows {
  /** Starts a pass of the pipeline; answers the workflow run id. */
  start(input: Omit<PipelineInput, "stub">): Promise<string>;
  cancel(workflowRunId: string): Promise<void>;
  /** Writes the stopped Run's state and an `end` to its stream, and closes it. */
  announceStopped(workflowRunId: string, patch: RunPatch): Promise<void>;
  events(workflowRunId: string, from: number): ReadableStream<RunEvent>;
}

/** A Run's live feed, from inside a workflow step: the row, its logs and the stream together. */
export interface RunFeed {
  /** Writes the patches and logs and streams the events; false when this pass no longer owns a going Run. */
  publish(
    pass: { runId: string; generation: number },
    events: RunEventInput[],
    rowOnly?: { grounding?: CheckResult | null },
  ): Promise<boolean>;
  close(): Promise<void>;
}

/** The Process as Verify left it. */
export type Verified = {
  process: Process;
  checks: CheckResult[];
  /** The reviewer's findings before any repair. */
  findings: ReviewFinding[];
  repaired: boolean;
};

export type Designed = {
  plan: DeckPlan;
  /** Set when the model's plan was unusable and the deck was planned by rule. */
  fallback: string | null;
};

/**
 * The paid half of the pipeline: every model call a Stage makes, with the
 * cleaning around it. The live Analyst calls the models through the AI
 * Gateway and tracks each call's cost; the scripted one (stubbed e2e) makes
 * no call and answers from the Sample. The Rules' Checks are code either way.
 */
export interface Analyst {
  watch(ctx: RunContext, row: RunRow, origin: string): Promise<Watch>;
  extract(
    ctx: RunContext,
    input: { watch: Watch; rules: RuleSet; models: ModelChoice },
  ): Promise<Process>;
  verify(
    ctx: RunContext,
    input: {
      process: Process;
      watch: Watch;
      rules: RuleSet;
      models: ModelChoice;
    },
    note: (text: string) => Promise<void>,
  ): Promise<Verified>;
  design(
    ctx: RunContext,
    input: {
      round: number;
      by: DeckRound["by"];
      process: Process;
      previous: DeckRound | null;
      rules: RuleSet;
      models: ModelChoice;
    },
  ): Promise<Designed>;
  check(
    ctx: RunContext,
    input: {
      round: number;
      plan: DeckPlan;
      process: Process;
      rules: RuleSet;
      models: ModelChoice;
    },
  ): Promise<{ checks: CheckResult[]; findings: ReviewFinding[] }>;
}

/** The pipeline's own reads and claims of the Run it works on (by the id it was started with). */
export interface PipelineRuns {
  run(id: string): Promise<RunRow | null>;
  status(id: string, generation: number): Promise<RunStatus | null>;
  claim(id: string, generation: number): Promise<boolean>;
}
