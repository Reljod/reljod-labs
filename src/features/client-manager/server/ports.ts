import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type {
  AssistantEvent,
  CitedFact,
  Proposal,
  TrailStep,
} from "../domain/chat";
import type {
  BuildEvent,
  BuildEventInput,
  Persona,
  Usage,
} from "../domain/events";
import type {
  DraftEdge,
  DraftGraph,
  DraftNode,
  Extraction,
  Issue,
  Repair,
} from "../domain/graph";
import type { LimitKind } from "../domain/limits";
import type { BookClient } from "./book";
import type { GatheredSource } from "./gather";
import type { CallContext } from "./llm";
import type * as Repository from "./repository";
import type { Db } from "./repository";

/*
 * What the Client Manager services need from the outside world. The
 * containers (`container.ts` for requests, `work-container.ts` for a Build's
 * workflow steps) wire the real adapters (`adapters.ts`, the model calls,
 * Storage, the Workflow SDK); unit tests and the stubbed e2e suite hand in
 * others.
 */

/**
 * A repository function's signature with plain arrays for answers: the
 * adapters return postgres.js row lists (arrays with query metadata), and a
 * fake need not.
 */
type Port<F> = F extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Promise<R extends readonly (infer T)[] ? T[] : R>
  : F;

/** Who a call is for: the Owner whose clients and Threads it reaches, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

/** Clients and the reads of one Client file (`client_manager.clients` and its graph). */
export interface ClientStore {
  get: Port<typeof Repository.getClient>;
  /** The Client file's first frame, in one statement. Not scoped: the service checks the Owner. */
  file: Port<typeof Repository.clientFile>;
  catalog: Port<typeof Repository.listCatalog>;
  /** The client's row and its Root Node, on the transaction that holds its cap. */
  create: Port<typeof Repository.createClientRow>;
  setStatus: Port<typeof Repository.setClientStatus>;
  setPortrait: Port<typeof Repository.setPortrait>;
  /** Soft delete: every read stops seeing the client at once. */
  remove: Port<typeof Repository.deleteClient>;
  toPurge: Port<typeof Repository.clientsToPurge>;
  purge: Port<typeof Repository.purgeClient>;
  edges: Port<typeof Repository.edgesInScope>;
  node: Port<typeof Repository.nodeDetail>;
  source: Port<typeof Repository.sourceDetail>;
}

/** Builds, their Sources and the Build messages of a client. */
export interface BuildStore {
  create: Port<typeof Repository.createBuild>;
  /** Queued to running, once: of two starts, one wins. */
  claim: Port<typeof Repository.claimBuild>;
  get: Port<typeof Repository.getBuild>;
  /** The Build and its client's Owner, in one statement. */
  withClient: Port<typeof Repository.buildWithClient>;
  update: Port<typeof Repository.updateBuild>;
  latest: Port<typeof Repository.latestBuild>;
  createSources: Port<typeof Repository.createSources>;
  addMessage: Port<typeof Repository.addMessage>;
}

/** Threads and their messages. */
export interface ThreadStore {
  create: Port<typeof Repository.createThread>;
  get: Port<typeof Repository.getThread>;
  list: Port<typeof Repository.listThreads>;
  update: Port<typeof Repository.updateThread>;
  remove: Port<typeof Repository.deleteThread>;
  addMessage: Port<typeof Repository.addThreadMessage>;
  /** A Thread's messages, only when the Thread is the Owner's. */
  messages: Port<typeof Repository.threadMessages>;
  history: Port<typeof Repository.threadHistory>;
  message: Port<typeof Repository.getThreadMessage>;
  /** Open to decided, once: of two clicks, one wins. */
  decide: Port<typeof Repository.decideProposal>;
  setProposal: Port<typeof Repository.setProposal>;
}

/** The graph reads the MCP tools make. */
export interface GraphStore {
  categoryCounts: Port<typeof Repository.categoryCounts>;
  edgesInScope: Port<typeof Repository.edgesInScope>;
  searchAcross: Port<typeof Repository.searchNodesAcross>;
  nodesByKeys: Port<typeof Repository.nodesByKeys>;
  expandNodes: Port<typeof Repository.expandNodes>;
  edgesByIds: Port<typeof Repository.edgesByIds>;
  edgesAmong: Port<typeof Repository.edgesAmong>;
  connectNodes: Port<typeof Repository.connectNodes>;
  nodesInCategory: Port<typeof Repository.nodesInCategory>;
  evidenceForKeys: Port<typeof Repository.evidenceForKeys>;
  sources: Port<typeof Repository.sourcesOfClient>;
  factsPerSource: Port<typeof Repository.factsPerSource>;
  sourceDetail: Port<typeof Repository.sourceDetail>;
  usageSince: Port<typeof Repository.usageSince>;
  /** Cited Nodes of any number of clients, in one statement. */
  cited: Port<typeof Repository.nodesByClientKeys>;
}

/**
 * Client Manager's caps (`LIMITS`). It counts the rows that hold a place
 * (Builds, questions) and the day's spend, so the place is taken by writing
 * that row inside the locked transaction, not a separate rate-hit row.
 */
export interface Caps {
  /** Throws a LimitError if one more of `kind` is over a cap; takes nothing (a portrait). */
  check(visitor: Visitor, kind: LimitKind, owner: string | null): Promise<void>;
  /**
   * Takes one place: counts under advisory locks on the visitor, the Owner
   * and the kind's global cap, then runs `hold` (the insert of the row that
   * holds it) on the same transaction; or throws a LimitError.
   */
  take<T>(
    visitor: Visitor,
    owner: string | null,
    kind: LimitKind,
    hold: (db: Db) => Promise<T>,
  ): Promise<T>;
}

/** The private `client-manager` bucket. */
export interface Files {
  uploadUrl(path: string): Promise<string>;
  upload(path: string, data: Uint8Array, contentType: string): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  /** An Owner's own file, signed per request. */
  signedUrl(path: string): Promise<string | null>;
  signedUrls(paths: string[]): Promise<Map<string, string>>;
  /** A Sample's file: signed once and reused while it has an hour left. */
  sampleUrl(path: string): Promise<string | null>;
  sampleUrls(paths: string[]): Promise<Map<string, string>>;
  removeFolder(prefix: string): Promise<number>;
  exists(path: string): Promise<boolean>;
}

/** The image model that paints a Portrait. Paid. */
export interface Painter {
  paint(
    context: CallContext,
    prompt: string,
  ): Promise<{ image: Uint8Array; mediaType: string; usage: Usage }>;
}

/** The embedding model behind a search and the Embed job. Paid. */
export interface Embedder {
  embed(
    context: CallContext,
    values: string[],
  ): Promise<{ embeddings: number[][]; usage: Usage | null }>;
}

/** What a Build's workflow is started with (the workflow's only argument). */
export type BuildInput = {
  buildId: string;
  clientId: string;
  visitorHash: string;
  trigger: "intake" | "addition";
  /**
   * Started by a stubbed e2e request: its steps use the canned models
   * (`work-container.ts`). Absent on Builds started before it existed.
   */
  stub?: boolean;
};

/** The Workflow SDK, as the Build service reaches it. */
export interface BuildWorkflows {
  /** Starts a Build's workflow; the container adds whether it is stubbed. */
  start(input: BuildInput): Promise<string>;
  cancel(workflowRunId: string): Promise<void>;
  /** Tells whoever watches that the Build was stopped. Best effort. */
  announceStopped(workflowRunId: string): Promise<void>;
  events(workflowRunId: string, from: number): ReadableStream<BuildEvent>;
}

/** What one Desk answer ended with. */
export type Turn = {
  text: string;
  reasoning: string;
  trail: TrailStep[];
  cited: CitedFact[];
  proposal: Proposal | null;
  buildId: string | null;
  buildClientId: string | null;
};

/**
 * The Desk: a model walking the graphs through the MCP server (in process),
 * and with Research on, the web. The live one calls the chat model; the
 * stubbed e2e suite's is a script over the same MCP server.
 */
export interface Desk {
  converse(input: {
    origin: string;
    owner: Owner;
    visitor: Visitor;
    clients: BookClient[];
    scopeClientId: string | null;
    research: boolean;
    question: string;
    history: { role: "user" | "assistant"; content: string }[];
    signal?: AbortSignal;
  }): AsyncGenerator<AssistantEvent, Turn>;
}

/** Runs work after the answer is sent (`after` in Next; inline in tests). */
export type Later = (work: () => Promise<void>) => void;

// A Build's workflow steps -------------------------------------------------------------

/** Reads one Source into Nodes and Edges, reporting each as soon as it is complete. Paid. */
export interface Extractor {
  extract(input: {
    context: CallContext;
    clientName: string;
    source: GatheredSource;
    /** The graph so far, for additions: Keys to reuse. */
    known: string;
    onNode: (node: DraftNode) => Promise<void>;
    onEdge: (edge: DraftEdge) => Promise<void>;
  }): Promise<{ extraction: Extraction; usage: Usage }>;
}

/** The second model that reviews the Draft graph and answers with Repairs. Paid. */
export interface Critic {
  critique(input: {
    context: CallContext;
    clientName: string;
    graph: DraftGraph;
    sources: GatheredSource[];
    issues: Issue[];
    round: number;
    earlier: string[];
  }): Promise<{
    verdict: "clean" | "needs_changes";
    notes: string;
    repairs: Repair[];
    usage: Usage;
  }>;
}

/** Infers the Persona from the committed graph. Paid. */
export interface PersonaWriter {
  infer(input: {
    context: CallContext;
    clientName: string;
    graph: DraftGraph;
  }): Promise<{ persona: Persona; usage: Usage }>;
}

/** The Build's event stream (the workflow run's writable). */
export interface BuildEmitter {
  emit(...events: BuildEventInput[]): Promise<void>;
  close(): Promise<void>;
}

/** The graph writes and reads of a Build. */
export interface BuildGraphStore {
  client: Port<typeof Repository.getClient>;
  build: Port<typeof Repository.getBuild>;
  updateBuild: Port<typeof Repository.updateBuild>;
  sourcesOfBuild: Port<typeof Repository.sourcesOfBuild>;
  setSourceTexts: Port<typeof Repository.setSourceTexts>;
  loadGraph: Port<typeof Repository.loadGraph>;
  commitGraph: Port<typeof Repository.commitGraph>;
  recordRepairs: Port<typeof Repository.recordRepairs>;
  nodesWithoutEmbedding: Port<typeof Repository.nodesWithoutEmbedding>;
  setEmbeddings: Port<typeof Repository.setEmbeddings>;
  setPersona: Port<typeof Repository.setPersona>;
  setPortrait: Port<typeof Repository.setPortrait>;
  setClientStatus: Port<typeof Repository.setClientStatus>;
  buildSpend: Port<typeof Repository.buildSpend>;
  addMessage: Port<typeof Repository.addMessage>;
}
