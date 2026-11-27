import type { Owner } from "@/features/access/domain/owner";
import type { RateLimiter } from "@/platform/rate/limiter";
import type { Visitor } from "@/platform/request/visitor";
import type { ReadyUpload } from "../domain/catalog";
import type {
  ChatEvent,
  ConversationSummary,
  Message,
  MessagePart,
  MessageUsage,
} from "../domain/chat";
import type { ViewRecord, ViewWork } from "../domain/payload";
import type { CheckFinding, Rulebook } from "../domain/rules";
import type {
  ActorKind,
  TrailAction,
  TrailEvent,
  TrailUsage,
} from "../domain/trail";
import type { Verification } from "../domain/verify";
import type { ParamValues, QueryResult, ViewSpec } from "../domain/view";

/*
 * What Canvas's services need from outside the process. The container
 * (`container.ts`) wires the real adapters (Postgres, Vercel Sandbox, the
 * model gateway, the MCP server in process); unit tests and the stubbed e2e
 * suite hand in fakes or canned ones.
 */

/**
 * Who a service call acts for. Every Canvas service that reads or writes
 * takes one, so the page, the chat and the MCP server go down the same path
 * with the same Owner scope, limits and Trail.
 */
export type Caller = {
  owner: Owner;
  visitor: Visitor;
  /** Who the Trail names: the person, the Analyst (a chat turn) or an outside MCP client. */
  actor: ActorKind;
  /** The Conversation a chat turn belongs to. */
  conversationId?: string;
  /** The Question being answered: its caps apply to every Run made for it. */
  questionId?: string;
};

// Limits -------------------------------------------------------------------------------------

/** What a visitor spends against the hourly caps in `LIMITS`. */
export type SpendKind = "question" | "run";
export type CanvasRate = RateLimiter<SpendKind>;

// The Trail ----------------------------------------------------------------------------------

export type TrailInput = {
  action: TrailAction;
  summary: string;
  detail?: Record<string, unknown>;
  viewId?: string | null;
  boardId?: string | null;
  usage?: TrailUsage;
  ms?: number;
  /** Overrides the Caller's actor: a tool the Analyst called writes as the Analyst. */
  actor?: ActorKind;
};

export type TrailFilter = {
  conversationId?: string;
  questionId?: string;
  viewId?: string;
  boardId?: string;
  /** Events older than this id. */
  before?: number;
  limit?: number;
};

/** The append-only Trail (`canvas.events`). Writes that must stand with an event take it in their own transaction. */
export interface TrailRepository {
  /** After the fact; best effort in production (a failed insert is logged, never thrown). */
  record(caller: Caller, input: TrailInput): Promise<number | null>;
  /** Before the work it announces: throws when it cannot be written. */
  strict(caller: Caller, input: TrailInput): Promise<number>;
  list(owner: Owner, filter: TrailFilter): Promise<TrailEvent[]>;
}

// Saved data ---------------------------------------------------------------------------------

/** The Owner's Workspace row, which every other row hangs off. */
export interface WorkspaceRepository {
  /** Makes it on first use; idempotent and cheap once made. */
  ensure(owner: Owner): Promise<void>;
}

/** Where the next Question was filed. */
export type FiledQuestion = {
  conversationId: string;
  questionId: string;
  title: string;
};

export interface ConversationRepository {
  list(owner: Owner, limit: number): Promise<ConversationSummary[]>;
  /** Whether the Conversation is the Owner's and not deleted. */
  exists(owner: Owner, id: string): Promise<boolean>;
  /** Its messages, oldest first (empty for one that is not the Owner's). */
  messages(owner: Owner, id: string): Promise<Message[]>;
  /**
   * Files a Question, with its Trail events, in one transaction: in the
   * Conversation given (null when it is not the Owner's), or in a new one,
   * titled `title`, once `admitNew(open)` (the count of the Owner's open
   * Conversations, under a lock) has not thrown. `events` are written under
   * the filed Conversation and Question; `started` says it is a new one.
   */
  fileQuestion(
    caller: Caller,
    input: { conversationId?: string; text: string; title: string },
    admitNew: (open: number) => void,
    events: (filed: FiledQuestion, started: boolean) => TrailInput[],
  ): Promise<FiledQuestion | null>;
  /** Saves the Analyst's answer to the Caller's Question. */
  fileAnswer(
    caller: Caller,
    answer: {
      content: string;
      parts: MessagePart[];
      usage: Omit<MessageUsage, "type"> | null;
    },
  ): Promise<string | null>;
  /** Sandbox milliseconds the Caller's Question has used. */
  sandboxMs(owner: Owner, questionId: string): Promise<number>;
  spendSandbox(owner: Owner, questionId: string, ms: number): Promise<void>;
  /**
   * Soft-deletes the Conversation and its Views not pinned to a Board, with
   * its Trail event, in one transaction. False when it is not the Owner's.
   */
  softDelete(
    caller: Caller,
    id: string,
    event: (title: string) => TrailInput,
  ): Promise<boolean>;
}

/** A saved View as the repository holds it: the record, and what is kept to run it again. */
export type StoredView = ViewRecord & { guarded: Guarded };

/** What a computed View saves. */
export type ViewValues = {
  spec: ViewSpec;
  params: ParamValues;
  result: QueryResult;
  verification: Verification;
  findings: CheckFinding[];
  status: "verified" | "flagged";
  rulebookVersion: number;
  work: ViewWork;
  guarded: Guarded;
};

export interface ViewRepository {
  /** The Owner's View, or null (not theirs, deleted, or not an id). */
  get(owner: Owner, id: string): Promise<StoredView | null>;
  /** A Conversation's Views oldest first (none once it is deleted), or with no Conversation the Owner's latest. */
  list(
    owner: Owner,
    conversationId: string | undefined,
    limit: number,
  ): Promise<StoredView[]>;
  countInConversation(owner: Owner, conversationId: string): Promise<number>;
  /** Views beside this one: the same open Conversation, or a Board in common. */
  neighbours(
    owner: Owner,
    view: StoredView,
    limit: number,
  ): Promise<StoredView[]>;
  /** Saves a new View with its Trail event in one transaction. */
  insert(
    caller: Caller,
    values: ViewValues,
    event: (id: string) => TrailInput,
  ): Promise<StoredView>;
  /** Saves new values over the Owner's View (revision + 1) with its Trail event in one transaction; null when it is gone. */
  update(
    caller: Caller,
    id: string,
    values: Partial<ViewValues>,
    event: TrailInput,
  ): Promise<StoredView | null>;
}

export type RulebookVersion = {
  version: number;
  rulebook: Rulebook;
  changed: string[];
  savedAt: string | null;
};

export type RulebookHistory = {
  version: number;
  changed: string[];
  savedAt: string;
}[];

export interface RulebookRepository {
  /** The Owner's latest Version, or null when they never edited. */
  latest(owner: Owner): Promise<RulebookVersion | null>;
  history(owner: Owner, limit: number): Promise<RulebookHistory>;
  /** Saves Version n + 1 under the Owner's lock, with its Trail event in one transaction. */
  save(
    caller: Caller,
    rulebook: Rulebook,
    changed: string[],
    event: (version: number) => TrailInput,
  ): Promise<RulebookVersion>;
}

export interface UploadRepository {
  /** The Owner's ready Uploads, oldest first. */
  ready(owner: Owner): Promise<ReadyUpload[]>;
}

// The Sandbox --------------------------------------------------------------------------------

export type Job = { op: string } & Record<string, unknown>;
export type JobAnswer = Record<string, unknown> & {
  error?: string;
  kind?: "timeout" | "sql" | "runner";
  missing?: string[];
};

/** Where every Query is parsed and run: the Owner's Vercel Sandbox, or a canned one for the stubbed e2e suite. */
export interface SandboxRunner {
  run(
    owner: Owner,
    job: Job,
    seconds: number,
  ): Promise<{ answer: JobAnswer; ms: number }>;
}

/** A statement the Guard passed, kept with a View so a Control runs it again without parsing. */
export type GuardedStatement = {
  /** For code: the input's name. */
  name?: string;
  /** The SQL as written. */
  sql: string;
  /** The statement to run when the Guard changed it; null when the SQL runs as written. */
  ast: unknown | null;
  tables: string[];
  restrictedUsed: string[];
  guardedSelects: number;
};

export type Guarded = {
  rulebookVersion: number;
  statements: GuardedStatement[];
};

// The Analyst --------------------------------------------------------------------------------

/** One Question for the Analyst, with what its MCP client needs. */
export type AnalystTurn = {
  text: string;
  signal: AbortSignal;
  /** The in-process MCP client for this turn: the Canvas MCP server with the turn's token. */
  connect: () => Promise<McpClient>;
  /** What the model is told, read only by a model turn. */
  prepare: () => Promise<{ system: string; history: Message[] }>;
  /** A model call finished: on the Trail, and counted against the USD cap. */
  onModelCall: (
    usage: TrailUsage,
    detail: Record<string, unknown>,
  ) => Promise<void>;
};

/**
 * The model behind the Analyst: the gateway, or the e2e suite's scripted
 * tool sequence. It yields the turn's events; the chat service saves them.
 */
export interface Analyst {
  /** The model id the Trail and the usage line name. */
  model(): string;
  answer(
    turn: AnalystTurn,
    spent: { calls: TrailUsage[] },
  ): AsyncGenerator<ChatEvent>;
}

/** The slice of an MCP client the services use (`@ai-sdk/mcp`). */
export type McpClient = {
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
  tools(): Promise<Record<string, unknown>>;
  /** `resources/read` of the View App, as an MCP Apps host reads it. */
  readApp(): Promise<McpAppResource>;
  close(): Promise<void>;
};

/** Opens an MCP client on the Canvas MCP server, in process, with a bearer. */
export type McpConnector = (input: {
  token: string;
  origin: string;
  clientName: string;
}) => Promise<McpClient>;

/** The View App read through `resources/read`. */
export type McpAppResource = { html: string; meta?: Record<string, unknown> };

// Access -------------------------------------------------------------------------------------

/** Whether a token's holder may still act: read on every MCP request. */
export interface AccessChecks {
  /** A Guest's current pass, by Auth user. */
  guestPass(user: string): Promise<{
    id: string;
    expires_at: string;
    revoked_at: string | null;
    deleted_at: string | null;
  } | null>;
  hostEmails(): string[];
  /** The e2e suite is switched on here (`E2E_BYPASS_TOKEN`). */
  e2eEnabled(): boolean;
}
