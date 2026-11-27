import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type {
  AuditAction,
  AuditActor,
  AuditPage,
  AuditUsage,
} from "../domain/audit";
import type { RunRefusal } from "../domain/limits";
import type { Rulebook } from "../domain/rulebook";
import type { AppliedRule, RuleId } from "../domain/rules";
import type {
  ClientDeclaration,
  DocumentJudgments,
  DocumentKind,
  ExtractedDocument,
  FieldName,
  FieldReading,
  Finding,
  SourceFormat,
  Span,
  SpanCorrection,
} from "../domain/types";
import type { ReadUsage } from "../metrics";
import type { FindingView, RunView, SessionRunView } from "../view";
import type { ParsedDocument, ParserName } from "./parsers";

/**
 * What the Document compliance services need from the outside world. The
 * container (`container.ts`) wires the real adapters; tests hand in fakes,
 * and the stubbed e2e suite swaps only the model (`reader`).
 */

/** Who a call is for: the Owner every row is scoped to, who the Audit trail names, the visitor caps count against. */
export type Caller = { owner: Owner; actor: AuditActor; visitor: Visitor };

/** Ids of what was saved, so Findings can point at them. */
export type SavedDocument = {
  documentId: number;
  spanIds: Map<string, number>;
  fieldIds: Map<FieldName, number>;
};

/** The model's structured answer, exactly as it returned it; kept with the Document. */
export type RawExtraction = {
  corrections: SpanCorrection[];
  fields: FieldReading[];
  judgments: DocumentJudgments;
};

/** What the model read from one Document. */
export type DocumentExtraction = {
  readings: FieldReading[];
  judgments: DocumentJudgments;
  /** Fixes to OCR text, by Span ref; never to where a Span sits. */
  corrections: SpanCorrection[];
  usage: ReadUsage;
  raw: RawExtraction;
};

export type DocumentMeta = {
  storagePath: string;
  mediaType: string;
  sourceFormat: SourceFormat;
  parser: ParserName;
  pageCount: number;
  parseMs: number;
  readMs: number;
  usage: ReadUsage;
  raw: RawExtraction | null;
};

/** The Pre-screen runs and everything under them. Every read by id is scoped to the Owner. */
export interface RunRepository {
  /**
   * A queued run, counted against `limits` and inserted in one transaction
   * under an advisory lock, so two requests at once cannot both take the last
   * place. `limits` null skips the count (the e2e suite).
   */
  create(input: {
    packSlug: string;
    rulebook: Rulebook;
    declaration: ClientDeclaration;
    visitorHash: string;
    owner: Owner;
    model: string;
    limits: { perVisitorPerHour: number; perDay: number } | null;
  }): Promise<{ runId: string } | { refusal: RunRefusal }>;
  /** The Owner's newest finished run of a pack: where a limited visitor lands. */
  latestCompletedId(packSlug: string, owner: Owner): Promise<string | null>;
  setWorkflowRunId(runId: string, workflowRunId: string): Promise<void>;
  setStatus(runId: string, status: "parsing" | "evaluating"): Promise<void>;
  fail(runId: string, message: string): Promise<void>;
  /** The workflow run behind an Owner's run; null for anyone else's. */
  workflowRunIdOf(runId: string, owner: Owner): Promise<string | null>;
  /** An Owner's run, whole; null when it is missing or someone else's. */
  load(runId: string, owner: Owner): Promise<RunView | null>;
  /** An Owner's runs, newest first, each with its cost and Finding counts. */
  list(owner: Owner): Promise<SessionRunView[]>;
  saveDocument(
    runId: string,
    meta: DocumentMeta,
    document: ExtractedDocument,
  ): Promise<SavedDocument>;
  /** The Findings with their Evidence, and the run marked completed, together. */
  saveFindings(
    runId: string,
    findings: Finding[],
    saved: Map<DocumentKind, SavedDocument>,
  ): Promise<void>;
  /** The run's next Evaluation and its `run.reevaluated` event, in one transaction. */
  recordEvaluation(input: {
    owner: Owner;
    runId: string;
    rules: AppliedRule[];
    findings: FindingView[];
    createdBy: string;
    summary: string;
    details: Record<string, unknown>;
    max: number;
  }): Promise<{ number: number } | { refusal: "limit" | "gone" }>;
  /** A Reviewer decision and its `finding.reviewed` event, in one transaction. */
  recordReview(input: {
    owner: Owner;
    runId: string;
    evaluation: number;
    requirementId: string;
    findingOutcome: string;
    outcome: string;
    note: string;
    reviewer: string;
    summary: string;
    details: Record<string, unknown>;
    max: number;
  }): Promise<{ refusal: "limit" | "gone" | "stale" } | null>;
}

/** One saved state of one Rule for one Owner. */
export type SavedRuleVersion = {
  ruleId: string;
  version: number;
  enabled: boolean;
  params: unknown;
  restoredFrom: number | null;
  savedBy: string;
  savedAt: string;
};

export interface RuleRepository {
  /** The Owner's saved Versions, newest first; only one Rule's when given. */
  versions(owner: Owner, ruleId?: RuleId): Promise<SavedRuleVersion[]>;
  /** The Rule's next Version and its Audit event, in one transaction, under the hourly cap. */
  saveVersion(input: {
    owner: Owner;
    ruleId: RuleId;
    enabled: boolean;
    params: unknown;
    restoredFrom: number | null;
    savedBy: string;
    summary: string;
    details: Record<string, unknown>;
    maxPerHour: number;
  }): Promise<{ version: number } | { refusal: "limit" }>;
}

export type AuditInput = {
  owner: Owner;
  runId: string | null;
  actor: AuditActor;
  action: AuditAction;
  summary: string;
  details?: Record<string, unknown>;
  usage?: AuditUsage | null;
};

/** The Owner's append-only Audit trail. */
export interface AuditLog {
  /** Appends one event, or throws. */
  append(event: AuditInput): Promise<void>;
  list(
    owner: Owner,
    filter: {
      runId?: string | null;
      action?: AuditAction | null;
      before?: number | null;
      /** Events a page holds; 50 unless said. */
      limit?: number;
    },
  ): Promise<AuditPage>;
}

/** The private bucket that holds the preset packs. */
export interface PackStore {
  download(path: string): Promise<Uint8Array>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

/** Turns a Document into Spans inside the app (free: no model). */
export interface DocumentParser {
  parse(input: {
    file: Uint8Array;
    sourceFormat: SourceFormat;
    pageImages: Uint8Array[];
  }): Promise<ParsedDocument>;
}

/** The paid step: the model reads one Document's fields as Span references. */
export interface DocumentReader {
  /** The model id a new run records. */
  readonly model: string;
  read(input: {
    packSlug: string;
    kind: DocumentKind;
    spans: Span[];
    /** Whether the Spans came from OCR, the only text the reader may correct. */
    ocr: boolean;
    pageImages: { data: Uint8Array; mediaType: string }[];
    /** Each field as soon as it is read, before the whole answer is in. */
    onReading?: (reading: FieldReading) => Promise<void>;
  }): Promise<DocumentExtraction>;
}

/** What the Pre-screen workflow is started with; plain data. */
export type PrescreenStart = {
  runId: string;
  packSlug: string;
  kinds: DocumentKind[];
  rules: AppliedRule[];
  owner: Owner;
};

/** The durable Pre-screen workflow (`prescreen-workflow.ts`). */
export interface PrescreenWorkflow {
  /** Starts a run; resolves with the workflow run id. */
  start(input: PrescreenStart): Promise<string>;
  /** A workflow run's ScanEvents, from event `from` on. */
  events(workflowRunId: string, from: number): AsyncIterable<unknown>;
}

export type DocumentCompliancePorts = {
  runs: RunRepository;
  rules: RuleRepository;
  audit: AuditLog;
  packs: PackStore;
  parser: DocumentParser;
  reader: DocumentReader;
  workflow: PrescreenWorkflow;
  /** Reports an Audit event about work that stands either way, and was lost. */
  logLost: (action: AuditAction, error: unknown) => void;
};
