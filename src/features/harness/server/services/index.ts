import "server-only";
import type {
  AuditLog,
  AuditRepository,
  ChatAgent,
  ConflictChecker,
  Embedder,
  HarnessRate,
  KnowledgeRepository,
  Later,
  RuleRepository,
  RunRepository,
  RunSources,
  SessionRepository,
  SessionSandboxes,
  SkillRepository,
  SourceFiles,
  SourceTexts,
  Workflows,
  WorkspaceRepository,
} from "../ports";
import { type AuditService, createAuditService } from "./audit";
import { type ChatService, createChatService } from "./chat";
import { type ConnectService, createConnectService } from "./connect";
import { createFirstView } from "./first-view";
import { createKnowledgeService, type KnowledgeService } from "./knowledge";
import {
  createRecordService,
  type RecordRepository,
  type RecordService,
} from "./records";
import { createRuleService, type RuleService } from "./rules";
import { createRunService, type RunService } from "./runs";
import { createSandboxService, type SandboxService } from "./sandbox";
import { createSessionService, type SessionService } from "./sessions";
import { createSkillService, type SkillService } from "./skills";
import { createStaffService, type StaffService } from "./staff";

/** Everything outside the process Harness's services reach. */
export type HarnessPorts = {
  workspace: WorkspaceRepository;
  sessions: SessionRepository;
  runs: RunRepository;
  runSources: RunSources;
  rules: RuleRepository;
  skills: SkillRepository;
  knowledge: KnowledgeRepository;
  records: RecordRepository;
  trail: AuditRepository;
  audit: AuditLog;
  rate: HarnessRate;
  texts: SourceTexts;
  files: SourceFiles;
  embedder: Embedder;
  conflicts: ConflictChecker;
  sandboxes: SessionSandboxes;
  workflows: Workflows;
  /** The Agent, given the services so it can call the MCP server in process. */
  agent: (services: Omit<HarnessServices, "chat">) => ChatAgent;
  later: Later;
  newId: () => string;
  now: () => number;
  today: () => string;
  secret: () => string;
  /** Model Steps of a Run use their fallbacks (the stubbed e2e suite). */
  stubSteps: boolean;
};

/** Harness's services, one per area. Routes, MCP tools and pages reach the Workspace only through these. */
export type HarnessServices = {
  staff: StaffService;
  sessions: SessionService;
  chat: ChatService;
  runs: RunService;
  rules: RuleService;
  skills: SkillService;
  knowledge: KnowledgeService;
  records: RecordService;
  audit: AuditService;
  sandbox: SandboxService;
  connect: ConnectService;
  /** The page's first view: the lists its open tabs read, in one round. */
  firstView: ReturnType<typeof createFirstView>;
};

export function createHarnessServices(ports: HarnessPorts): HarnessServices {
  const sessions = createSessionService(ports);
  const knowledge = createKnowledgeService({ ...ports, sessions });
  const staff = createStaffService({
    workspace: ports.workspace,
    audit: ports.audit,
    // A Workspace seeded just now: embed its seed Passages off the response.
    seeded: (owner) => ports.later(() => knowledge.backfill(owner)),
  });
  const runs = createRunService({
    ...ports,
    sources: ports.runSources,
    sessions,
  });
  const rules = createRuleService(ports);
  const skills = createSkillService(ports);
  const rest = {
    staff,
    sessions,
    runs,
    rules,
    skills,
    knowledge,
    records: createRecordService(ports),
    audit: createAuditService(ports),
    sandbox: createSandboxService({ ...ports, sessions }),
    connect: createConnectService({ ...ports, staff }),
    firstView: createFirstView({ sessions, runs, rules, skills, knowledge }),
  };
  const chat = createChatService({
    sessions,
    sources: (actor) => knowledge.sources(actor),
    agent: ports.agent(rest),
  });
  return { ...rest, chat };
}
