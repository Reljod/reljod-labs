import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { RateLimiter } from "@/platform/rate/limiter";
import type { Visitor } from "@/platform/request/visitor";
import type {
  ActorKind,
  AuditAction,
  AuditEvent,
  AuditInput,
  AuditUsage,
} from "../domain/audit";
import type { ChatEvent } from "../domain/chat-events";
import type { AttachmentNote } from "../domain/chat-turn";
import type {
  ConflictView,
  Passage,
  PassageHit,
  SourceKind,
  SourceView,
} from "../domain/knowledge";
import type { ApprovalRisk } from "../domain/permissions";
import type { PipelineId } from "../domain/pipeline";
import type { RuleStates } from "../domain/pipelines/apply";
import type { RuleState, RuleVersion, RuleView } from "../domain/rules";
import type {
  RunEvent,
  RunEventInput,
  RunStatus,
  RunSummary,
  RunView,
  StartedVia,
} from "../domain/run";
import type {
  SandboxFile,
  SandboxFileContent,
  SandboxRunResult,
} from "../domain/sandbox";
import type {
  MessagePart,
  MessageRole,
  MessageView,
  SessionSummary,
} from "../domain/session";
import type { SkillText, SkillVersion, SkillView } from "../domain/skills";
import type { Staff } from "../domain/staff";
import type { CheckedPassage, CheckResult } from "./knowledge/conflict-check";
import type { SourceMeta } from "./pipelines/source-file";
import type { RunRow } from "./pipelines/store";
import type { ApprovalAnswer, RunContext } from "./pipelines/types";

/*
 * What Harness's services need from outside the process. The container
 * (`container.ts`) wires the adapters (the SQL modules, the model gateway,
 * Storage, Vercel Sandbox, the Workflow SDK); unit tests hand in fakes; the
 * stubbed e2e suite gets canned adapters for everything that costs money.
 */

// Who is asking ------------------------------------------------------------------------

/**
 * Who a service call acts as: the Owner whose Workspace it reaches and the
 * Staff member whose Role it is checked against and whose name the Audit
 * event carries. The REST stack builds one (`withStaff`); so does an MCP
 * token's claims.
 */
export type Actor = { owner: Owner; staff: Staff };

/** An Actor doing capped work: the visitor hash its hourly limits count against. */
export type PaidActor = Actor & { visitor: Visitor };

/** A PaidActor with the Access that let it in: what minting a token needs. */
export type Caller = PaidActor & { access: Access };

// Shared ports -------------------------------------------------------------------------

/** The capped kinds of work (`harness.rate_hits.kind`). */
export type SpendKind =
  | "message"
  | "run"
  | "source"
  | "search"
  | "sandbox_command";

export type HarnessRate = RateLimiter<SpendKind>;

export type OwnedAuditInput = AuditInput & { owner: Owner };

/** The append-only Audit trail (ADR 0018). */
export interface AuditLog {
  /** After the fact, best effort: never fails the work it records (in production). */
  record(input: OwnedAuditInput): Promise<number | null>;
  /** Before work that must not happen untraced: throws when it cannot be written. */
  strict(input: OwnedAuditInput): Promise<void>;
}

/** Runs work after the answer is sent (`after` in Next; inline in tests). */
export type Later = (work: () => Promise<void>) => void;

// Workspace and Staff ------------------------------------------------------------------

export interface WorkspaceRepository {
  /**
   * Makes sure the Workspace exists and holds the current seed; true when it
   * seeded now (its Passages then wait for embeddings).
   */
  ensure(owner: Owner): Promise<boolean>;
  /** Forgets that an Owner was seeded: their Workspace turned out to be gone. */
  forget(owner: Owner): void;
  /** The Workspace's Staff: users first, then admins. */
  staff(owner: Owner): Promise<Staff[]>;
  /** One of the Owner's Staff, or null; an id from anywhere is checked here. */
  ownedStaff(owner: Owner, staffId: unknown): Promise<Staff | null>;
}

// Sessions -----------------------------------------------------------------------------

export type NewMessage = {
  role: MessageRole;
  staff: Staff | null;
  content: string;
  parts: MessagePart[];
  usage: AuditUsage | null;
};

export interface SessionRepository {
  list(owner: Owner, staffId: string): Promise<SessionSummary[]>;
  owned(owner: Owner, sessionId: unknown): Promise<SessionSummary | null>;
  /** Opens a Session with its event, under the Workspace's lock; null when it already holds `max`. */
  create(input: {
    owner: Owner;
    staffId: string;
    title: string;
    max: number;
    event: (sessionId: string) => OwnedAuditInput;
  }): Promise<string | null>;
  rename(
    owner: Owner,
    sessionId: string,
    title: string,
    event: OwnedAuditInput,
  ): Promise<void>;
  messages(owner: Owner, sessionId: string): Promise<MessageView[]>;
  /** Saves a message, the Session's title and its event in one transaction. */
  append(input: {
    owner: Owner;
    sessionId: string;
    title: string;
    message: NewMessage;
    event: (messageId: string) => OwnedAuditInput;
  }): Promise<{ id: string; createdAt: string }>;
  /** The Sources attached in a Session (uploaded in it or carried by its messages). */
  attachments(owner: Owner, sessionId: string): Promise<Attachment[]>;
}

export type Attachment = import("../domain/attachments").Attachment;

// Chat ---------------------------------------------------------------------------------

/** A Staff message saved and ready for the Agent's answer. */
export type AgentTurn = {
  caller: Caller;
  session: SessionSummary;
  text: string;
  attached: AttachmentNote[];
  history: { role: "user" | "assistant"; content: string }[];
  origin: string;
};

/** The chat model at work in a Session (or the e2e suite's canned one). */
export interface ChatAgent {
  /**
   * The Agent's answer as ChatEvents (text, tool calls and cards, usage). It
   * returns what the turn cost, saved on the Agent's message; the service
   * saves the message and ends the stream with `done`.
   */
  answer(
    turn: AgentTurn,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent, { usage: AuditUsage | null }>;
}

// Runs ---------------------------------------------------------------------------------

/** An Approval as decided under its row lock. */
export type ApprovalClaim = {
  id: string;
  runId: string;
  risk: ApprovalRisk;
  status: string;
  hookToken: string | null;
  title: string;
  kind: string;
  startedBy: string;
  sessionId: string | null;
  runStatus: RunStatus;
  workflowRunId: string | null;
};

export type ApprovalDecision = {
  status: "approved" | "returned";
  note: string | null;
  decidedBy: string;
  event: OwnedAuditInput;
};

export interface RunRepository {
  /** Runs still holding one of the Workspace's places (active, not stale). */
  busy(owner: Owner): Promise<number>;
  /**
   * Saves a queued Run, its pending Steps and its event, under the
   * Workspace's Run lock after sweeping stale Runs; refuses (`busy`) when
   * the Workspace already holds `max`.
   */
  insert(input: {
    owner: Owner;
    sessionId: string | null;
    pipelineId: PipelineId;
    input: Record<string, unknown>;
    ruleVersions: Record<string, number>;
    startedBy: string;
    via: StartedVia;
    stepIds: string[];
    max: number;
    event: (runId: string) => OwnedAuditInput;
  }): Promise<{ runId: string } | { busy: number }>;
  setWorkflow(
    owner: Owner,
    runId: string,
    workflowRunId: string,
  ): Promise<void>;
  setStatus(
    owner: Owner,
    runId: string,
    status: RunStatus,
    extra?: { error?: string | null },
  ): Promise<boolean>;
  row(owner: Owner, runId: string): Promise<RunRow | null>;
  view(owner: Owner, runId: string): Promise<RunView | null>;
  list(
    owner: Owner,
    filter: { sessionId?: string | null; limit?: number },
  ): Promise<RunSummary[]>;
  /** Marks an active Run stopped, its running Steps skipped and its Approvals expired. */
  markStopped(owner: Owner, runId: string, error: string): Promise<void>;
  /**
   * Locks the Approval with its Run and hands it (null when it is not the
   * Owner's) to `decide`, which throws to refuse. The decision and its
   * event are saved in the same transaction, only while the Approval is
   * still pending (`applied` false when it was decided a moment ago).
   */
  decide(
    owner: Owner,
    approvalId: string,
    decide: (claim: ApprovalClaim | null) => ApprovalDecision,
  ): Promise<{ claim: ApprovalClaim; applied: boolean }>;
}

/** The Workflow SDK, which carries a Run's Steps. */
export interface Workflows {
  start(ctx: RunContext): Promise<string>;
  cancel(workflowRunId: string, reason: string): Promise<void>;
  resume(hookToken: string, answer: ApprovalAnswer): Promise<void>;
  /** The Run's event stream from `startIndex`. */
  reader(
    workflowRunId: string,
    startIndex: number,
  ): ReadableStreamDefaultReader<RunEvent>;
  /** Writes a last event to the stream and closes it; best effort. */
  close(workflowRunId: string, event: RunEventInput): Promise<void>;
}

// Rules and Skills ---------------------------------------------------------------------

export type RulePlan = {
  state: Omit<RuleState, "version">;
  note: string | null;
  event: (version: number) => OwnedAuditInput;
};

export interface RuleRepository {
  list(owner: Owner, pipelineId?: PipelineId | null): Promise<RuleView[]>;
  statesAsOf(
    owner: Owner,
    pipelineId: PipelineId,
    asOf: string,
  ): Promise<RuleStates>;
  history(owner: Owner, ruleId: string): Promise<RuleVersion[]>;
  /**
   * Saves Version n+1 of a Rule under its lock: `plan` is handed the Rule's
   * latest state and every saved Version and throws to refuse.
   */
  saveVersion(
    owner: Owner,
    ruleId: string,
    staffId: string,
    plan: (rule: {
      current: RuleState;
      versions: (Omit<RuleState, "version"> & { version: number })[];
    }) => RulePlan,
  ): Promise<RuleView>;
}

export type SkillPlan = {
  text: SkillText;
  note: string | null;
  event: (version: number) => OwnedAuditInput;
};

export interface SkillRepository {
  list(owner: Owner): Promise<SkillView[]>;
  get(owner: Owner, skillId: string): Promise<SkillView | null>;
  history(owner: Owner, skillId: string): Promise<SkillVersion[]>;
  /** Saves Version n+1 of a Skill under its lock; `plan` throws to refuse. */
  saveVersion(
    owner: Owner,
    skillId: string,
    staffId: string,
    plan: (skill: {
      current: SkillText & { version: number };
      versions: (SkillText & { version: number })[];
    }) => SkillPlan,
  ): Promise<SkillView>;
}

// Knowledge ----------------------------------------------------------------------------

export type SourceTextRow = {
  id: string;
  title: string;
  kind: SourceKind;
  storage_path: string | null;
  extracted_text: string | null;
};

export type ClaimedSource = SourceTextRow & { document_date: string | null };

export type NewSource = {
  id: string;
  title: string;
  kind: SourceKind;
  bytes: number;
  storagePath: string | null;
  text: string | null;
  documentDate: string | null;
  sessionId: string | null;
  addedBy: string;
};

export type InsertedPassage = {
  id: number;
  ordinal: number;
  heading: string | null;
  body: string;
};

export type FoundConflict = CheckResult["found"][number];

export interface KnowledgeRepository {
  /** Fails reads that died, so no Source stays stuck in `reading`. */
  clearStale(owner: Owner): Promise<void>;
  sources(owner: Owner): Promise<SourceView[]>;
  source(owner: Owner, sourceId: string): Promise<SourceView | null>;
  passages(owner: Owner, sourceId: string): Promise<Passage[]>;
  textRow(owner: Owner, sourceId: string): Promise<SourceTextRow | null>;
  /** Live (not removed) Sources in the Workspace. */
  count(owner: Owner): Promise<number>;
  /** Deletes stale pending Sources and old removed ones (a batch each); their files' paths. */
  sweep(owner: Owner): Promise<string[]>;
  insert(owner: Owner, source: NewSource): Promise<void>;
  /** Deletes a Source still waiting for its file (its upload URL failed). */
  dropPending(owner: Owner, sourceId: string): Promise<void>;
  /** Takes a Source for reading (once, a few tries); null when it is not to be read now. */
  claim(
    owner: Owner,
    sourceId: string,
    maxReads: number,
  ): Promise<ClaimedSource | null>;
  fail(owner: Owner, sourceId: string, message: string): Promise<void>;
  /** Replaces the claimed Source's Passages, with their embeddings and the document date. */
  savePassages(input: {
    owner: Owner;
    sourceId: string;
    passages: { heading: string | null; body: string }[];
    vectors: (number[] | null)[];
    documentDate: string | null;
  }): Promise<InsertedPassage[]>;
  /** Saves the Conflicts found, marks the Source ready and writes the events, in one transaction. */
  file(input: {
    owner: Owner;
    sourceId: string;
    found: FoundConflict[];
    event: (sessionId: string | null, conflicts: number) => OwnedAuditInput;
    conflictEvent: (
      sessionId: string | null,
      conflictId: string,
      found: FoundConflict,
    ) => OwnedAuditInput;
  }): Promise<string[]>;
  /**
   * Soft-removes a Source (and frees what it superseded) with its event;
   * `check` is handed the locked row and throws to refuse.
   */
  remove(input: {
    owner: Owner;
    sourceId: string;
    /** Handed the locked row (null when it is not the Owner's); throws to refuse. */
    check: (row: { isSeed: boolean } | null) => void;
    event: (
      row: {
        id: string;
        title: string;
        kind: string;
        sessionId: string | null;
      },
      passagesRestored: number,
    ) => OwnedAuditInput;
  }): Promise<void>;
  conflicts(
    owner: Owner,
    filter?: {
      id?: string;
      status?: "open" | "resolved" | null;
      sourceId?: string;
    },
  ): Promise<ConflictView[]>;
  /**
   * Settles an open Conflict under its row lock: `plan` is handed the row
   * (null when it is not the Owner's, or its Source was removed) and throws
   * to refuse; the mark on the Passage and the event go together. False
   * when it was settled a moment ago.
   */
  settle(input: {
    owner: Owner;
    conflictId: string;
    decidedBy: string;
    resolution: string;
    plan: (
      row: {
        status: "open" | "resolved";
        newPassageId: number;
        oldPassageId: number;
      } | null,
    ) => {
      supersede: { passageId: number; by: number } | null;
      event: OwnedAuditInput;
    };
  }): Promise<boolean>;
  search(
    owner: Owner,
    text: string,
    vector: number[] | null,
    count: number,
  ): Promise<PassageHit[]>;
  hasUnembedded(owner: Owner): Promise<boolean>;
  unembedded(
    owner: Owner,
    limit: number,
  ): Promise<{ id: number; heading: string | null; body: string }[]>;
  setEmbeddings(rows: { id: number; embedding: number[] }[]): Promise<void>;
}

/** A Source's text as the Agent and the Pipelines read it: cached, or read from its file and cached. */
export interface SourceTexts {
  /** Throws an UnreadableError (`knowledge/extract.ts`) when the file cannot be read. */
  of(owner: Owner, row: SourceTextRow): Promise<string>;
  /** A Source and its text, filed or not; null when it is not the Owner's; an InvalidError says why a file cannot be read. */
  read(
    owner: Owner,
    sourceId: string,
  ): Promise<{ source: SourceView; text: string } | null>;
}

/** The private `harness` bucket. */
export interface SourceFiles {
  uploadUrl(path: string): Promise<string>;
  signedUrl(path: string, seconds: number): Promise<string>;
  remove(path: string): Promise<void>;
}

/** The embedding model (paid). Never throws: a failed batch is nulls. */
export interface Embedder {
  embedAll(
    texts: string[],
  ): Promise<{ vectors: (number[] | null)[]; usage: AuditUsage | null }>;
  /** One search query's vector, or null (no gateway, an outage). */
  embedQuery(text: string): Promise<number[] | null>;
}

/** The model that compares new Passages with old ones (paid). */
export interface ConflictChecker {
  check(input: {
    owner: Owner;
    source: { id: string; title: string; documentDate: string | null };
    passages: CheckedPassage[];
    deadline: number;
  }): Promise<CheckResult>;
}

// Audit --------------------------------------------------------------------------------

export interface AuditRepository {
  /** One page of the trail, newest first; `own` is only the Staff member's own Sessions' events. */
  page(filter: {
    owner: Owner;
    staffId: string;
    scope: "workspace" | "own";
    mine: boolean;
    sessionId: string | null;
    actorKind: ActorKind | null;
    action: AuditAction | null;
    before: number | null;
    limit: number;
  }): Promise<{ events: AuditEvent[]; nextBefore: number | null }>;
}

// Sandbox ------------------------------------------------------------------------------

/** Vercel Sandbox, one per Session (paid). Throws a ConflictError "Sandbox unavailable: …". */
export interface SessionSandboxes {
  readonly configured: boolean;
  write(
    sessionId: string,
    owner: Owner,
    path: string,
    content: string,
  ): Promise<{ created: boolean }>;
  run(
    sessionId: string,
    owner: Owner,
    command: string,
    timeoutMs: number,
  ): Promise<SandboxRunResult>;
  read(sessionId: string, path: string): Promise<SandboxFileContent>;
  list(sessionId: string, dir: string): Promise<SandboxFile[]>;
}

/** A Source's metadata as a Run takes it as input. */
export interface RunSources {
  meta(owner: Owner, ids: string[]): Promise<SourceMeta[]>;
}
