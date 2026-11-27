import type { ModelMessage } from "ai";
import type { Owner } from "@/features/access/domain/owner";
import type {
  DocumentSource,
  DocumentText,
  ExtractedName,
  ModelChoice,
  Rulebook,
  RulebookVersion,
  RunEventInput,
} from "../domain/contract";
import type { CallCost } from "./llm";
import type { ReaderJob, ReaderResult } from "./reader";
import type { RunRow, StoredEvent, UploadRow } from "./run-row";
import type { CodeResult } from "./sandbox";
import type { SieveClaims } from "./toolkit/mcp-token";
import type { SandboxFile } from "./toolkit/sandbox-files";
import type { RunContext, SweepCandidate } from "./toolkit/state";

/*
 * What Sieve's services need from outside the process. The containers wire
 * the adapters (`adapters.ts`: the SQL in `repository.ts`, Storage, the
 * Workflow SDK; `work-container.ts`: the model gateway and Vercel Sandbox).
 * Unit tests hand in fakes; the stubbed e2e suite gets the scripted Analyst,
 * the Sweep-backed Readers and a Sandbox that starts nothing (`stubs.ts`).
 */

// Repositories ----------------------------------------------------------------------

/** The caps `create` enforces under one lock; null skips them (the e2e suite). */
export type RunCaps = {
  perOwnerPerDay: number;
  perVisitorPerHour: number;
  activePerOwner: number;
} | null;

export type NewRun = {
  owner: Owner;
  visitorHash: string;
  title: string;
  pages: number;
  source: DocumentSource;
  models: ModelChoice;
  rulebookVersion: number;
  rulebook: Rulebook;
  limits: RunCaps;
};

export type RunEnding = Partial<
  Pick<
    RunRow,
    | "status"
    | "error"
    | "names"
    | "score"
    | "cost_usd"
    | "gate_passed"
    | "stopped_by"
  >
>;

export interface RunRepository {
  /** Counts the caps and inserts under one advisory lock, so two starts never both take the last place. */
  create(input: NewRun): Promise<{ runId: string } | { refusal: string }>;
  /** A Run, if the Owner owns it; null for another Owner's or a malformed id. */
  owned(owner: Owner, runId: string): Promise<RunRow | null>;
  /** A Run by id with no Owner check: only after the Owner was checked, or for the workflow. */
  get(runId: string): Promise<RunRow | null>;
  /** The Owner's Runs, newest first. */
  list(owner: Owner, limit: number): Promise<RunRow[]>;
  setWorkflow(runId: string, workflowRunId: string): Promise<void>;
  /** Ends a Run still going; true only for the call that ended it. */
  endIfGoing(runId: string, patch: RunEnding): Promise<boolean>;
}

/** The Audit trail: append-only. */
export interface EventRepository {
  append(runId: string, events: RunEventInput[]): Promise<void>;
  /** Events after a seq, in order. */
  after(runId: string, afterSeq: number, limit: number): Promise<StoredEvent[]>;
  /** Every event of a Run, in order. */
  all(runId: string): Promise<StoredEvent[]>;
  /** The Register in the latest `names` event, or null. */
  latestNames(runId: string): Promise<ExtractedName[] | null>;
}

export interface RulebookRepository {
  /** The Owner's latest version, or the default (version 0). */
  current(owner: Owner): Promise<RulebookVersion>;
  /** Every saved version, newest first, then the default. */
  versions(owner: Owner): Promise<RulebookVersion[]>;
  /** The next version, counted against the daily cap under one lock; a null cap skips it. */
  save(
    owner: Owner,
    rulebook: Rulebook,
    note: string | null,
    perOwnerPerDay: number | null,
  ): Promise<{ version: number } | { refusal: string }>;
}

export interface UploadRepository {
  insert(input: {
    id: string;
    owner: Owner;
    title: string;
    pages: number;
    storagePath: string;
  }): Promise<void>;
  owned(owner: Owner, uploadId: string): Promise<UploadRow | null>;
  countSince(owner: Owner, since: Date): Promise<number>;
}

// Storage, Documents, workflows -----------------------------------------------------

/** The private `name-extraction` bucket. */
export interface UploadStore {
  /** A one-time URL the browser PUTs `{ pages }` to, or null when Storage refuses. */
  signedUploadUrl(
    path: string,
  ): Promise<{ signedUrl: string; token: string } | null>;
}

/** A Document's text: a Corpus Document from its seed, an Upload from Storage (checked). */
export type LoadDocument = (source: DocumentSource) => Promise<DocumentText>;

/** The durable Run workflow. */
export interface RunWorkflows {
  /** Starts the workflow for a Run; resolves to its workflow run id. */
  start(ctx: RunContext): Promise<string>;
  /** Cancels it; best effort, may throw if it already ended. */
  cancel(workflowRunId: string): Promise<void>;
}

// Paid work -------------------------------------------------------------------------

export type ToolCall = { toolCallId: string; toolName: string; input: unknown };

/** What one Analyst model call gave back: its tools come back unexecuted. */
export type AnalystReply = {
  text: string;
  toolCalls: ToolCall[];
  /** The messages to append to the history (the assistant's turn). */
  responseMessages: ModelMessage[];
  /** The call's tokens and price, already recorded; null when nothing was billed. */
  cost: CallCost | null;
};

/** The Analyst's model: one call per turn, with the tools as schemas only. */
export interface AnalystModel {
  turn(input: {
    ctx: RunContext;
    instructions: string;
    messages: ModelMessage[];
    /** The Document and its Sweep, for a script that plays the Analyst (cached per instance). */
    prepared: () => Promise<{
      document: DocumentText;
      candidates: SweepCandidate[];
    }>;
  }): Promise<AnalystReply>;
}

/** One Reader over one page range. Reports its own failures; never throws. */
export interface ReaderModel {
  read(input: {
    ctx: RunContext;
    pages: string[];
    candidates: SweepCandidate[];
    job: ReaderJob;
  }): Promise<ReaderResult>;
}

/** The Run's Sandbox for `run_code`. Never throws: a failure is a result with a non-zero exit. */
export interface CodeSandbox {
  run(input: {
    runId: string;
    callId: string;
    code: string;
    document: () => Promise<DocumentText>;
    state: SandboxFile[];
  }): Promise<CodeResult>;
  /** Stops and deletes the Run's Sandbox, if it has one. Best effort. */
  dispose(runId: string): Promise<void>;
}

// The request side's ports ----------------------------------------------------------

export type SievePorts = {
  runs: RunRepository;
  events: EventRepository;
  rulebooks: RulebookRepository;
  uploads: UploadRepository;
  store: UploadStore;
  loadDocument: LoadDocument;
  workflows: RunWorkflows;
  /** Only `dispose`: a stopped Run's Sandbox goes at once. */
  sandbox: Pick<CodeSandbox, "dispose">;
  /** Signs an MCP token's claims (with RATE_LIMIT_SALT). */
  signToken: (claims: SieveClaims) => string;
  /** These are the stubbed e2e suite's services: the Runs they start and the tokens they mint stay stubbed. */
  stub: boolean;
  now: () => number;
  newId: () => string;
  /** Polls the events stream waits between reads; resolves early on abort. */
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
};
