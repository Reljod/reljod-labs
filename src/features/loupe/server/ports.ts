import type { ModelMessage } from "ai";
import type { Owner } from "@/features/access/domain/owner";
import type { RateLimiter } from "@/platform/rate/limiter";
import type { Visitor } from "@/platform/request/visitor";
import type { AuditAction, AuditEvent } from "../domain/api";
import type {
  Box,
  CheckId,
  DocumentFormat,
  DocumentKind,
  DocumentSource,
  Driver,
  ExaminationSummary,
  Forgery,
  StopReason,
  StoredEvent,
  TrailEventInput,
  UploadSummary,
} from "../domain/contract";
import type { Rulebook, RulebookVersion } from "../domain/rules";
import type {
  ExaminationPatch,
  ExaminationPulse,
  ExaminationRow,
  ExaminationState,
} from "./examination";
import type { CallCost } from "./llm";
import type { DocumentFile, Prepared, RunOutput } from "./sandbox";

/*
 * What Loupe's services need from outside the process. The container
 * (`container.ts`) wires the adapters: the SQL in `repository.ts`, Storage,
 * Vercel Sandbox, the model gateway and the Workflow SDK. Unit tests hand in
 * fakes; the stubbed e2e suite gets the scripted Examiner and the recorded
 * Sandbox.
 */

// Who is asking ------------------------------------------------------------------------

/** Who an app or MCP call acts for: the Owner it is scoped to and the visitor whose caps it spends. */
export type Who = {
  owner: Owner;
  visitor: Visitor;
  /** Where the request came in, for a Sample's file. */
  origin: string;
  via: "app" | "mcp";
};

/** Who is calling a tool. Built by the MCP server from a verified token, never from tool input. */
export type Caller = {
  owner: Owner;
  visitor: Visitor;
  /**
   * The in-app Examiner, bound to the one Examination it was started for,
   * or the Owner's own client.
   */
  role: { kind: "examiner"; examinationId: string } | { kind: "client" };
  /** Where the request came in, for a Sample's file. */
  origin: string;
};

export type ToolCall = { toolCallId: string; toolName: string; input: unknown };

export type EndOutcome =
  | {
      status: "completed";
      summary?: string;
      note?: string;
      stoppedBy?: StopReason;
    }
  | { status: "failed"; error: string };

// Repositories -------------------------------------------------------------------------

export type NewExamination = {
  owner: Owner;
  visitorHash: string;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  source: DocumentSource;
  isForgery: boolean;
  model: string;
  driver: Driver;
  origin: string;
  stub: boolean;
  rulebookVersion: number;
  rulebook: Rulebook;
  via: "app" | "mcp";
  /** Null skips them (a trusted visitor). */
  limits: {
    perOwnerPerDay: number;
    perVisitorPerHour: number;
    activePerOwner: number;
    staleMs: number;
  } | null;
};

/** Which limit refused a new Examination, and how many it already counted. */
export type ExaminationRefusal = {
  over: "active" | "day" | "hour";
  count: number;
};

export type StateChange<T> = (
  row: ExaminationRow,
) =>
  | { state: ExaminationState; patch?: ExaminationPatch; result: T }
  | { refusal: string };

export interface ExaminationRepository {
  /** Inserts it with its Audit event, counting the limits under advisory locks. */
  create(
    input: NewExamination,
  ): Promise<{ examinationId: string } | ExaminationRefusal>;
  get(examinationId: string): Promise<ExaminationRow | null>;
  /** The Examination, only if it is this Owner's. */
  owned(owner: Owner, examinationId: string): Promise<ExaminationRow | null>;
  /** Whether it is this Owner's, without reading the row. */
  owns(owner: Owner, examinationId: string): Promise<boolean>;
  /** Status and the few fields a poll needs, never the state. */
  pulse(examinationId: string): Promise<ExaminationPulse | null>;
  list(owner: Owner): Promise<ExaminationSummary[]>;
  update(examinationId: string, patch: ExaminationPatch): Promise<void>;
  /** Ends it if still going; true only for the call that ended it. */
  endIfGoing(
    examinationId: string,
    patch: ExaminationPatch & { status: "completed" | "failed" | "stopped" },
  ): Promise<boolean>;
  /** Changes the working state under a row lock (ADR 0028). */
  mutate<T>(
    examinationId: string,
    change: StateChange<T>,
  ): Promise<{ result: T; row: ExaminationRow } | { refusal: string }>;
}

/** The Trail: an Examination's append-only events. */
export interface TrailRepository {
  append(examinationId: string, events: TrailEventInput[]): Promise<void>;
  after(
    examinationId: string,
    after: number,
    limit?: number,
  ): Promise<StoredEvent[]>;
  all(examinationId: string): Promise<StoredEvent[]>;
}

export type RulebookInsert = {
  owner: Owner;
  rulebook: Rulebook;
  note: string | null;
  /** Null skips the cap (a trusted visitor). */
  perDay: number | null;
  via: "app" | "mcp";
};

export interface RulebookRepository {
  /** Every version, newest first, then the Defaults. The first is the current one. */
  list(owner: Owner): Promise<RulebookVersion[]>;
  current(owner: Owner): Promise<RulebookVersion>;
  /** The next version with its Audit event, in one transaction. */
  insert(
    input: RulebookInsert,
  ): Promise<
    | { version: number; changes: string[] }
    | { over: number }
    | { unchanged: true }
  >;
}

export type UploadRow = {
  id: string;
  owner: Owner;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  content_type: string;
  bytes: number;
  storage_path: string;
  forgery: Forgery | null;
  created_at: string;
};

export type UploadInsert = {
  id: string;
  owner: Owner;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  contentType: string;
  bytes: number;
  storagePath: string;
  forgery: Forgery | null;
  visitorHash: string;
  perDay: number | null;
  via: "app" | "mcp";
};

export interface UploadRepository {
  /** The row and its Audit event, in one transaction, under the daily cap. */
  insert(input: UploadInsert): Promise<{ ok: true } | { over: number }>;
  owned(owner: Owner, uploadId: string): Promise<UploadRow | null>;
  list(owner: Owner): Promise<UploadSummary[]>;
}

export type AuditDetail = Record<string, string | number | boolean | null>;

/** The Owner's append-only Audit trail. */
export interface AuditRepository {
  /** The Owner's top-level row, which every other row cascades from. */
  ensureOwner(owner: Owner): Promise<void>;
  append(
    owner: Owner,
    action: AuditAction,
    via: "app" | "mcp",
    detail: AuditDetail,
  ): Promise<void>;
  list(owner: Owner): Promise<AuditEvent[]>;
}

/** Loupe's hourly and daily caps outside an Examination's own (`loupe.rate_events`). */
export type RateKind = "check" | "reevaluate" | "token";
export type LoupeRate = RateLimiter<RateKind>;

// Files, the Sandbox, the model and the workflow ----------------------------------------

/** The private `loupe` bucket. Keys are built by `storage.ts`, never from input. */
export interface DocumentStore {
  download(path: string): Promise<Buffer | null>;
  upload(path: string, bytes: Buffer | Uint8Array): Promise<void>;
  /** A one-time URL the browser PUTs one file to, or null when Storage refused. */
  signedUpload(
    path: string,
  ): Promise<{ signedUrl: string; token: string; path: string } | null>;
  /** The stored object's size, or null when it is not there. */
  storedSize(path: string): Promise<number | null>;
}

/** A Sample's own file, hash-checked. */
export type SampleFiles = (
  sampleId: string,
  origin: string,
) => Promise<{ bytes: Buffer; file: string }>;

export type Seed = () => Promise<DocumentFile>;

/** Where the Toolkit runs: Vercel Sandbox, or the recorded Sweep of a Sample. */
export interface ToolkitSandbox {
  /**
   * Whether Checks really run. False for the stub, and where Vercel Sandbox
   * is not set up: a Sample then uses its recorded Sweep and static pages,
   * and an Upload cannot be examined.
   */
  readonly live: boolean;
  prepare(examinationId: string, document: Seed): Promise<Prepared>;
  sweep(input: {
    examinationId: string;
    document: Seed;
    kind: DocumentKind;
  }): Promise<RunOutput>;
  check(input: {
    examinationId: string;
    document: Seed;
    source: DocumentSource;
    callId: string;
    check: CheckId;
    kind: DocumentKind;
    page?: number;
    box?: Box | null;
    afterEnd?: boolean;
  }): Promise<RunOutput>;
  code(input: {
    examinationId: string;
    document: Seed;
    callId: string;
    code: string;
  }): Promise<RunOutput>;
  crop(input: {
    examinationId: string;
    document: Seed;
    callId: string;
    page: number;
    box: Box | null;
  }): Promise<Buffer | null>;
  /** Stops and deletes the Examination's Sandbox. Best effort. */
  dispose(examinationId: string): Promise<void>;
}

/** One Examiner turn: what it said and the tool calls it asked for, unexecuted. */
export type ExaminerTurn = {
  text: string;
  toolCalls: ToolCall[];
  /** The model's own messages, to append to the conversation. */
  messages: ModelMessage[];
  /** The call's `cost` event (zero for the scripted Examiner). */
  cost: CallCost;
};

/** The Examiner's model: the gateway, or the e2e suite's scripted Examiner. */
export interface ExaminerModel {
  turn(row: ExaminationRow, messages: ModelMessage[]): Promise<ExaminerTurn>;
}

/** The durable workflow an Examination runs in. */
export interface ExaminationRuns {
  /** Starts `loupeExamination`; the run's id. */
  start(examinationId: string): Promise<string>;
  /** Cancels a run. Throws when it is already over or gone. */
  cancel(runId: string, reason: string): Promise<void>;
}

export type LoupePorts = {
  examinations: ExaminationRepository;
  trail: TrailRepository;
  rulebooks: RulebookRepository;
  uploads: UploadRepository;
  audit: AuditRepository;
  rate: LoupeRate;
  store: DocumentStore;
  samples: SampleFiles;
  sandbox: ToolkitSandbox;
  model: ExaminerModel;
  runs: ExaminationRuns;
  /**
   * The Loupe MCP server, in process: the in-app Examiner's tool calls go
   * through it (ADR 0028).
   */
  mcp: (request: Request) => Promise<Response>;
  /** Signs Loupe MCP tokens (`RATE_LIMIT_SALT`). */
  secret: () => string;
  /** The model an Examination asked for, else `LOUPE_MODEL`, else the default. */
  modelFor: (asked?: string) => string;
  /** True only for the stubbed e2e suite: what it starts is marked so (`state.stub`). */
  stub: boolean;
  now: () => number;
  /**
   * Whether the Trail's write failures are thrown (outside production), so
   * a schema drift is seen at once; in production they are logged.
   */
  strictTrail: boolean;
};
