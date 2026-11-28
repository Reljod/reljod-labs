import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type { TrailEvent } from "../../domain/trail";
import type {
  AccessChecks,
  Analyst,
  Caller,
  CanvasRate,
  ConversationRepository,
  McpConnector,
  RulebookRepository,
  SandboxRunner,
  TrailFilter,
  TrailInput,
  TrailRepository,
  UploadRepository,
  ViewRepository,
  WorkspaceRepository,
} from "../ports";
import { type CatalogService, createCatalogService } from "./catalog";
import { type ChatService, createChatService } from "./chat";
import { type ConnectService, createConnectService } from "./connect";
import {
  type ConversationService,
  createConversationService,
} from "./conversations";
import { createHostService, type HostService } from "./host";
import { createRuleService, type RuleService } from "./rules";
import { createRunService, type RunService } from "./runs";
import { createViewService, type ViewService } from "./views";

/** Everything outside the process Canvas's services reach. */
export type CanvasPorts = {
  workspace: WorkspaceRepository;
  conversations: ConversationRepository;
  views: ViewRepository;
  rulebooks: RulebookRepository;
  uploads: UploadRepository;
  trail: TrailRepository;
  rate: CanvasRate;
  sandbox: SandboxRunner;
  analyst: Analyst;
  /** The Canvas MCP server, in process (the chat turn's and the Host's client). */
  mcp: McpConnector;
  access: AccessChecks;
  secret: () => string;
  now: () => number;
  /** The canned adapters are in use: tokens these services mint say so. */
  stub: boolean;
};

/** The Trail as the page and the MCP tools read and add to it. */
export interface TrailService {
  list(owner: Owner, filter: TrailFilter): Promise<TrailEvent[]>;
  record(caller: Caller, input: TrailInput): Promise<number | null>;
}

/** Canvas's services, one per area. Routes, MCP tools and the page reach the Workspace only through these. */
export type CanvasServices = {
  /** The person at the page, as a Caller: their Workspace is made on first use. */
  person(owner: Owner, visitor: Visitor): Promise<Caller>;
  runs: RunService;
  views: ViewService;
  conversations: ConversationService;
  rules: RuleService;
  catalog: CatalogService;
  trail: TrailService;
  chat: ChatService;
  connect: ConnectService;
  host: HostService;
};

export function createCanvasServices(ports: CanvasPorts): CanvasServices {
  const rules = createRuleService(ports);
  const runs = createRunService({ ...ports, rules });
  const views = createViewService({ ...ports, runs });
  const connect = createConnectService(ports);
  return {
    async person(owner, visitor) {
      await ports.workspace.ensure(owner);
      return { owner, visitor, actor: "person" };
    },
    runs,
    views,
    conversations: createConversationService({ ...ports, views }),
    rules,
    catalog: createCatalogService({ ...ports, rules }),
    trail: {
      list: (owner, filter) => ports.trail.list(owner, filter),
      record: (caller, input) => ports.trail.record(caller, input),
    },
    chat: createChatService({ ...ports, rules, views, connect }),
    connect,
    host: createHostService({ ...ports, connect }),
  };
}
