import type { LanguageModel, ToolSet } from "ai";
import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type { DocumentKind } from "../domain/document-kinds";
import type { ModelSettings } from "../domain/model-config";
import type { WatchlistEntry } from "../domain/rules/screening";
import type { Answer, RunEvent } from "../domain/run-events";
import type {
  Decision,
  FieldValue,
  Hit,
  RunDocument,
  RunState,
} from "../domain/run-state";
import type { RunContext } from "./jobs/context";
import type { ReadResult } from "./jobs/read";
import type { CallCost } from "./llm";
import type * as Repository from "./repository";
import type { SessionRow } from "./repository";
import type { RunInput } from "./run-workflow";

/**
 * What the Casework services need from the outside world. The containers
 * (`container.ts` for requests, `work-container.ts` for a Run's steps) wire
 * the real adapters; unit tests and the stubbed e2e suite hand in others.
 */

/**
 * A repository function's signature with plain arrays for answers: the
 * adapters return postgres.js row lists (arrays with query metadata), and a
 * fake need not.
 */
type Port<F> = F extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Promise<R extends readonly (infer T)[] ? T[] : R>
  : F;

/** Who a call is for: the Owner whose Desks it may reach, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

/** The Desks (`casework.sessions`). */
export interface DeskStore {
  create: Port<typeof Repository.createSession>;
  get: Port<typeof Repository.getSession>;
  /** The Owner's Desk with the remembered id, else their latest; never another Owner's. */
  openOf: Port<typeof Repository.openSessionOf>;
  listWithSpend: Port<typeof Repository.sessionsWithSpend>;
  touch: Port<typeof Repository.touchSession>;
  setModelOverrides: Port<typeof Repository.setModelOverrides>;
  orgModelSettings: Port<typeof Repository.orgModelSettings>;
  /** The one shared desk of an outside MCP client. */
  external: Port<typeof Repository.externalSession>;
}

/** The Cabinet: Case files, their Documents and each Desk's uploads. */
export interface CabinetStore {
  caseFiles: Port<typeof Repository.loadCaseFiles>;
  seedDocuments: Port<typeof Repository.loadSeedDocuments>;
  /** The Cabinet's Documents and one Desk's uploads, with labels. */
  cabinetOf: Port<typeof Repository.loadCabinetDocuments>;
  uploadsOf: Port<typeof Repository.loadUploads>;
  /** Documents by id that the Desk may use: the Cabinet's or its own uploads. */
  byIds: Port<typeof Repository.documentsByIds>;
  candidates: Port<typeof Repository.candidateDocuments>;
  asOf: Port<typeof Repository.asOfFor>;
  countUploads: Port<typeof Repository.countUploads>;
  recordedPaths: Port<typeof Repository.recordedUploadPaths>;
  insertUploads: Port<typeof Repository.insertUploads>;
}

/** Runs, their Jobs and their Questions. */
export interface RunStore {
  /** Counts the caps and creates the Run in one step (`casework.create_run`). */
  create: Port<typeof Repository.createRun>;
  get: Port<typeof Repository.getRun>;
  update: Port<typeof Repository.updateRun>;
  ofDesk: Port<typeof Repository.runsForSession>;
  withCosts: Port<typeof Repository.runsWithCosts>;
  active: Port<typeof Repository.activeRuns>;
  closeStopped: Port<typeof Repository.closeStoppedRun>;
  recordJob: Port<typeof Repository.recordJobRun>;
  createQuestion: Port<typeof Repository.createQuestion>;
  /** A Question with its Run's Desk. */
  question: Port<typeof Repository.questionWithDesk>;
  openQuestions: Port<typeof Repository.openQuestions>;
  markAnswered: Port<typeof Repository.markAnswered>;
}

export interface MessageStore {
  add: Port<typeof Repository.addMessage>;
  recent: Port<typeof Repository.loadMessages>;
}

/** Spend, and the chat caps that count it. */
export interface SpendStore {
  ofDesk: Port<typeof Repository.sessionSpend>;
  byDesk: Port<typeof Repository.spendBySession>;
  ofOwner: Port<typeof Repository.ownerSpendUsd>;
  /** Counts the chat caps and records the turn in one step (`casework.take_chat_turn`). */
  takeChatTurn: Port<typeof Repository.takeChatTurn>;
}

/** The private `casework` bucket. */
export interface CaseworkStorage {
  signedUrls(
    paths: string[],
    expiresInSeconds: number,
  ): Promise<Map<string, string>>;
  /** A one-time URL the browser uploads a file to. */
  signedUploadUrl(path: string): Promise<string>;
  /** The object's size and first bytes, or null when there is none. */
  stored(
    path: string,
    headBytes: number,
  ): Promise<{ size: number; head: Uint8Array } | null>;
  /** A text file's first `maxChars` characters, or null when it cannot be read. */
  text(path: string, maxChars: number): Promise<string | null>;
}

/** The durable workflows a Run is. */
export interface RunWorkflows {
  /** Starts a Run's workflow; answers its workflow run id. */
  start(input: RunInput): Promise<string>;
  /** Cancels a workflow. May throw for one that already ended. */
  cancel(workflowRunId: string): Promise<void>;
  /** Tells whoever watches that the Run was stopped, and closes its stream. */
  announceStopped(workflowRunId: string): Promise<void>;
  /** The Run's events from the `from`th on. */
  events(workflowRunId: string, from: number): ReadableStream<RunEvent>;
  /** Hands a person's Answer to the Run waiting on `token`. */
  resume(token: string, answer: Answer): Promise<void>;
}

/** The models a Run calls: Sort, Read, Adjudicate and Decide. Rules are code. */
export interface Reader {
  sort(
    ctx: RunContext,
    document: RunDocument,
  ): Promise<{ kind: DocumentKind | null; gist: string; cost: CallCost }>;
  read(
    ctx: RunContext,
    document: RunDocument,
    kind: DocumentKind,
    onField: (name: string, value: FieldValue) => Promise<void>,
  ): Promise<ReadResult>;
  adjudicate(
    ctx: RunContext,
    state: RunState,
    watchlist: WatchlistEntry[],
  ): Promise<{ hits: Hit[]; cost: CallCost | null }>;
  decide(
    ctx: RunContext,
    state: RunState,
  ): Promise<{ decision: Decision; cost: CallCost | null }>;
}

/** The AI SDK call options for the Specialist's model. */
export type SpecialistModel = (settings: ModelSettings) => {
  model: LanguageModel;
  reasoning?: NonNullable<ModelSettings["reasoning"]>;
  temperature?: number;
  maxOutputTokens?: number;
};

/** An MCP client of the Casework server, acting for one Desk. */
export type McpConnection = {
  tools(): Promise<ToolSet>;
  close(): Promise<void>;
};

export type McpConnector = (
  desk: SessionRow,
  origin: string,
) => Promise<McpConnection>;
