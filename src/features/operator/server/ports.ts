import type { Owner } from "@/features/access/domain/owner";
import type { GuestPassRow } from "@/features/access/server/repository";
import type {
  ManifestSummary,
  PendingApproval,
  RulebookVersion,
  RunEvent,
  RunEventInput,
  RunStatus,
} from "../domain/contract";
import type { Rulebook } from "../domain/rules";
import type { Change, Fixture } from "../legacy/types";
import type { RunContext } from "./context";
import type { TranscriptItem, TurnResult } from "./operator";
import type {
  ApprovalRow,
  ManifestParsed,
  ManifestRecord,
  NewRun,
  RunPatch,
  RunRow,
} from "./repository";
import type { ActRequest, ActResult, BooksReport } from "./sandbox/protocol";

/*
 * What the Operator's services need from outside the process. The container
 * (`container.ts`, `steps-container.ts`) wires the adapters: Postgres
 * (`repository.ts`), Storage (`storage.ts`), Vercel Sandbox (`screen.ts`,
 * `code-sandbox.ts`), the model (`operator.ts`) and the workflow runtime; or,
 * for the stubbed e2e suite, the in-process Screen and the scripted Operator.
 */

/** `operator.runs`. Functions that take only a run id are for callers already handed a checked one. */
export interface RunStore {
  /** Inserts a Run under its limits; a refusal says which one it hit. */
  create(input: NewRun): Promise<{ runId: string } | { refusal: string }>;
  owned(owner: Owner, runId: string): Promise<RunRow | null>;
  /** Whether the Run is the Owner's, without reading the row. */
  owns(owner: Owner, runId: string): Promise<boolean>;
  get(runId: string): Promise<RunRow | null>;
  status(runId: string): Promise<RunStatus | null>;
  list(owner: Owner, limit: number): Promise<RunRow[]>;
  update(runId: string, patch: RunPatch): Promise<void>;
  setWorkflowRun(runId: string, workflowRunId: string): Promise<void>;
  /** False when the Run is not in `from` any more. */
  move(
    runId: string,
    from: RunStatus[],
    to: "running" | "paused",
  ): Promise<boolean>;
  /** True only for the call that ended it. */
  endIfGoing(
    runId: string,
    patch: RunPatch & { status: "completed" | "failed" | "stopped" },
  ): Promise<boolean>;
  countHandSince(visitorHash: string, since: Date): Promise<number>;
  claimClientCall(runId: string): Promise<boolean>;
  releaseClientCall(runId: string): Promise<void>;
}

/** `operator.run_events`: append-only. */
export interface TrailStore {
  append(runId: string, events: RunEventInput[]): Promise<void>;
  after(runId: string, after: number, limit: number): Promise<RunEvent[]>;
}

/** `operator.approvals`. */
export interface ApprovalStore {
  insert(input: {
    id: string;
    runId: string;
    fingerprint: string;
    pending: PendingApproval;
    hookToken: string | null;
  }): Promise<void>;
  /** Null when it was already decided: the first decision stands. */
  decide(
    runId: string,
    approvalId: string,
    status: "approved" | "refused" | "expired",
  ): Promise<ApprovalRow | null>;
  get(runId: string, approvalId: string): Promise<ApprovalRow | null>;
  approvedFingerprints(runId: string): Promise<string[]>;
  expirePending(runId: string): Promise<void>;
  /** Time the Run has spent waiting for people. */
  pausedMs(runId: string): Promise<number>;
}

/** `operator.rulebooks`. */
export interface RulebookStore {
  current(owner: Owner): Promise<{ version: number; rulebook: Rulebook }>;
  versions(owner: Owner): Promise<RulebookVersion[]>;
  /** A null cap skips the daily count. */
  insert(
    owner: Owner,
    rulebook: Rulebook,
    note: string | null,
    dailyCap: number | null,
  ): Promise<{ version: number } | { refusal: string }>;
}

/** `operator.manifests`. */
export interface ManifestStore {
  countSince(owner: Owner, since: Date): Promise<number>;
  insert(input: {
    id: string;
    owner: Owner;
    name: string;
    kind: "csv" | "pdf";
    storagePath: string;
  }): Promise<void>;
  owned(owner: Owner, id: string): Promise<ManifestRecord | null>;
  saveRead(id: string, body: string, parsed: ManifestParsed): Promise<void>;
  fail(id: string): Promise<void>;
  list(owner: Owner): Promise<ManifestSummary[]>;
}

/** The private bucket's Frames (`frames/<run id>/<n>.png`). */
export interface FrameStore {
  put(runId: string, n: number, png: Buffer): Promise<void>;
  get(runId: string, n: number): Promise<Buffer | null>;
}

/** The private bucket's Manifest files (`manifests/<hashed owner>/<id>.<ext>`). */
export interface ManifestFiles {
  /** A one-time URL the browser PUTs the file to; null when it cannot be opened. */
  uploadUrl(path: string): Promise<{ signedUrl: string; token: string } | null>;
  download(path: string): Promise<Uint8Array | null>;
  /** A PDF's text; throws an `UnreadableError` for one with no text layer. */
  pdfText(bytes: Uint8Array): Promise<string>;
}

/** A Run's Screen sandbox: HARBOURMASTER, the Guard and the driver (ADR 0026). */
export interface ScreenPort {
  /** Whether a Screen can be started here at all. */
  available(): boolean;
  /** Starts the Screen; throws a ScreenUnavailable when it cannot. */
  boot(input: {
    runId: string;
    fixture: Fixture;
    rulebook: Rulebook;
    secret: string;
  }): Promise<void>;
  /** One Action through the Guard, and the picture after it. */
  act(runId: string, secret: string, request: ActRequest): Promise<ActResult>;
  /** Tells the Guard a person approved exactly this change. */
  approve(runId: string, secret: string, fingerprint: string): Promise<void>;
  touch(runId: string, secret: string): Promise<void>;
  /** More time for a wait the harness imposed. Best effort. */
  extend(runId: string, ms: number): Promise<void>;
  books(runId: string, secret: string): Promise<BooksReport>;
  /** Removes the Screen. Best effort, never throws. */
  dispose(runId: string): Promise<void>;
}

export type CodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

/** The Code sandbox `run_code` runs in: a separate microVM with no network. */
export interface CodeRunner {
  /** Never throws: a failure is a result with a non-zero exit code. */
  run(input: {
    ctx: RunContext;
    callId: string;
    code: string;
    keyed: Change[];
  }): Promise<CodeResult>;
  /** Best effort, never throws. */
  dispose(runId: string): Promise<void>;
}

/** The Operator itself: one model call a Turn (or the scripted Operator's next Turn). */
export interface OperatorModel {
  turn(
    ctx: RunContext,
    transcript: TranscriptItem[],
    turn: number,
  ): Promise<Extract<TurnResult, { kind: "turn" }>>;
}

/** The durable workflow an Operator-driven Run runs in (`run-workflow.ts`). */
export interface RunWorkflow {
  /** Starts `operatorRun`; the workflow's own run id. */
  start(ctx: RunContext): Promise<string>;
  /** Best effort: a workflow that already ended throws, and that is fine. */
  cancel(workflowRunId: string, reason: string): Promise<void>;
  /** Wakes the Approval hook the workflow waits on. */
  resume(
    token: string,
    answer: { decision: "approved" | "refused" },
  ): Promise<void>;
}

/** What an MCP token is checked against on every call. */
export interface AccessLookup {
  guestPass(userId: string): Promise<GuestPassRow | null>;
  hostEmails(): string[];
  e2eEnabled(): boolean;
  /** RATE_LIMIT_SALT: it signs every Operator MCP token. */
  secret(): string;
}
