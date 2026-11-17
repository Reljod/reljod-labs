import { page as appAudit } from "./pages/app-audit";
import { page as appChat } from "./pages/app-chat";
import { page as appKnowledge } from "./pages/app-knowledge";
import { page as appPipelines } from "./pages/app-pipelines";
import { page as appRules } from "./pages/app-rules";
import { page as appSkills } from "./pages/app-skills";
import { page as appStaff } from "./pages/app-staff";
import { page as approvals } from "./pages/approvals";
import { page as archAccess } from "./pages/arch-access";
import { page as archAudit } from "./pages/arch-audit";
import { page as archChatTurn } from "./pages/arch-chat-turn";
import { page as archDataModel } from "./pages/arch-data-model";
import { page as archDurableRuns } from "./pages/arch-durable-runs";
import { page as archOverview } from "./pages/arch-overview";
import { page as archSandbox } from "./pages/arch-sandbox";
import { page as archSearch } from "./pages/arch-search";
import { page as auditTrail } from "./pages/audit-trail";
import { page as claudeConnect } from "./pages/claude-connect";
import { page as claudeHow } from "./pages/claude-how";
import { page as claudeLimits } from "./pages/claude-limits";
import { page as claudeOauth } from "./pages/claude-oauth";
import { page as claudePlugin } from "./pages/claude-plugin";
import { page as claudePrompts } from "./pages/claude-prompts";
import { page as claudeTools } from "./pages/claude-tools";
import { page as conflicts } from "./pages/conflicts";
import { page as connectClaudeQuick } from "./pages/connect-claude-quick";
import { page as contributionProcessing } from "./pages/contribution-processing";
import { page as delinquencyReport } from "./pages/delinquency-report";
import { page as demoMode } from "./pages/demo-mode";
import { page as deskRecords } from "./pages/desk-records";
import { page as inTheDemo } from "./pages/in-the-demo";
import { page as knowledgeBase } from "./pages/knowledge-base";
import { page as memberRequest } from "./pages/member-request";
import { page as memberServiceAnswers } from "./pages/member-service-answers";
import { page as opsAddConnector } from "./pages/ops-add-connector";
import { page as opsAddPipeline } from "./pages/ops-add-pipeline";
import { page as opsAddRule } from "./pages/ops-add-rule";
import { page as opsAddSkill } from "./pages/ops-add-skill";
import { page as opsAddTool } from "./pages/ops-add-tool";
import { page as opsDeploy } from "./pages/ops-deploy";
import { page as opsRoadmap } from "./pages/ops-roadmap";
import { page as opsRunner } from "./pages/ops-runner";
import { page as pipelinesRuns } from "./pages/pipelines-runs";
import { page as quickstart } from "./pages/quickstart";
import { page as refApi } from "./pages/ref-api";
import { page as refAuditActions } from "./pages/ref-audit-actions";
import { page as refDecisions } from "./pages/ref-decisions";
import { page as refEnv } from "./pages/ref-env";
import { page as refGlossary } from "./pages/ref-glossary";
import { page as refKnownGaps } from "./pages/ref-known-gaps";
import { page as refLimits } from "./pages/ref-limits";
import { page as rulebooksRules } from "./pages/rulebooks-rules";
import { page as rulesReference } from "./pages/rules-reference";
import { page as sandbox } from "./pages/sandbox";
import { page as sessionsAgent } from "./pages/sessions-agent";
import { page as skills } from "./pages/skills";
import { page as whatIsTheHarness } from "./pages/what-is-the-harness";
import { page as whyAHarnessForABank } from "./pages/why-a-harness-for-a-bank";
import { page as workspaceStaffRoles } from "./pages/workspace-staff-roles";
import type { DocPage, DocSection } from "./types";

/** Every page, in reading order. */
export const PAGES: DocPage[] = [
  whatIsTheHarness,
  whyAHarnessForABank,
  inTheDemo,
  quickstart,
  demoMode,
  connectClaudeQuick,
  workspaceStaffRoles,
  sessionsAgent,
  skills,
  rulebooksRules,
  pipelinesRuns,
  approvals,
  knowledgeBase,
  conflicts,
  auditTrail,
  sandbox,
  deskRecords,
  memberRequest,
  contributionProcessing,
  delinquencyReport,
  memberServiceAnswers,
  rulesReference,
  appChat,
  appPipelines,
  appSkills,
  appRules,
  appKnowledge,
  appAudit,
  appStaff,
  claudeHow,
  claudeConnect,
  claudeOauth,
  claudePlugin,
  claudeTools,
  claudeLimits,
  claudePrompts,
  archOverview,
  archChatTurn,
  archDurableRuns,
  archDataModel,
  archSearch,
  archAudit,
  archAccess,
  archSandbox,
  refApi,
  refEnv,
  refLimits,
  refKnownGaps,
  refAuditActions,
  refGlossary,
  refDecisions,
  opsDeploy,
  opsRunner,
  opsAddPipeline,
  opsAddRule,
  opsAddSkill,
  opsAddConnector,
  opsAddTool,
  opsRoadmap,
];

/** The navigation: sections, and the pages in each, in reading order. */
export const SECTIONS: DocSection[] = [
  {
    id: "introduction",
    title: "Introduction",
    pages: ["what-is-the-harness", "why-a-harness-for-a-bank", "in-the-demo"],
  },
  {
    id: "get-started",
    title: "Get started",
    pages: ["quickstart", "demo-mode", "connect-claude-quick"],
  },
  {
    id: "concepts",
    title: "Core concepts",
    pages: [
      "workspace-staff-roles",
      "sessions-agent",
      "skills",
      "rulebooks-rules",
      "pipelines-runs",
      "approvals",
      "knowledge-base",
      "conflicts",
      "audit-trail",
      "sandbox",
    ],
  },
  {
    id: "desk",
    title: "Pensions Operations Desk",
    pages: [
      "desk-records",
      "member-request",
      "contribution-processing",
      "delinquency-report",
      "member-service-answers",
      "rules-reference",
    ],
  },
  {
    id: "using",
    title: "Using the app",
    pages: [
      "app-chat",
      "app-pipelines",
      "app-skills",
      "app-rules",
      "app-knowledge",
      "app-audit",
      "app-staff",
    ],
  },
  {
    id: "claude",
    title: "Claude integration",
    pages: [
      "claude-how",
      "claude-connect",
      "claude-oauth",
      "claude-plugin",
      "claude-tools",
      "claude-limits",
      "claude-prompts",
    ],
  },
  {
    id: "architecture",
    title: "Architecture",
    pages: [
      "arch-overview",
      "arch-chat-turn",
      "arch-durable-runs",
      "arch-data-model",
      "arch-search",
      "arch-audit",
      "arch-access",
      "arch-sandbox",
    ],
  },
  {
    id: "reference",
    title: "Reference",
    pages: [
      "ref-api",
      "ref-env",
      "ref-limits",
      "ref-audit-actions",
      "ref-glossary",
      "ref-decisions",
      "ref-known-gaps",
    ],
  },
  {
    id: "operations",
    title: "Operations",
    pages: [
      "ops-deploy",
      "ops-runner",
      "ops-add-pipeline",
      "ops-add-rule",
      "ops-add-skill",
      "ops-add-connector",
      "ops-add-tool",
      "ops-roadmap",
    ],
  },
];

export const FIRST_PAGE_ID = "what-is-the-harness";

export function pageById(id: string | null | undefined): DocPage | null {
  return PAGES.find((page) => page.id === id) ?? null;
}
