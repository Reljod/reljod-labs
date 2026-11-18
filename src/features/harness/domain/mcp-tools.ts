import { LIMITS } from "./limits";
import type { Action } from "./permissions";
import { can } from "./permissions";
import { isPipelineId, type PipelineId, type PipelineSpec } from "./pipeline";
import { PIPELINES } from "./pipelines";
import { hrefOf } from "./place";
import type { Staff } from "./staff";

/*
 * The Harness MCP server (ADR 0013): where it lives, how outside clients sign
 * in to it, and every tool it offers, as data. The server registers exactly
 * these tools; the Docs tab and the Connect page render this list. No Node
 * imports, so client components can read it.
 */

/** The Harness MCP server. It checks its own bearer on every request. */
export const HARNESS_MCP_PATH = "/api/harness/mcp";
/** The Harness's own OAuth endpoints (`/register`, `/token`). */
export const HARNESS_OAUTH_PATH = "/api/harness/oauth";
/**
 * The path of the Harness's OAuth issuer, `<origin>/api/harness`. Its metadata
 * is at the path-suffixed well-known URL (RFC 8414 §3.1), so it never meets
 * the Client Manager's, whose issuer is the site's origin.
 */
export const HARNESS_ISSUER_PATH = "/api/harness";
export const HARNESS_AUTH_SERVER_METADATA_PATH = `/.well-known/oauth-authorization-server${HARNESS_ISSUER_PATH}`;
/** RFC 9728: the MCP server's 401 points here. */
export const HARNESS_PROTECTED_RESOURCE_PATH = `/.well-known/oauth-protected-resource${HARNESS_MCP_PATH}`;
/** The consent page, behind the Access gate. */
export const HARNESS_AUTHORIZE_PATH = "/demos/harness/mcp/authorize";
/** How to connect Claude. */
export const HARNESS_CONNECT_PATH = "/demos/harness/mcp";
export const HARNESS_OAUTH_SCOPE = "harness";
/** Where a Guest's OAuth requests carry their pasted Harness token (ADR 0012's rule). */
export const GUEST_TOKEN_HEADER = "X-Guest-Token";
/** The name the server gives itself, and the one `claude mcp add` uses. */
export const MCP_SERVER_NAME = "harness";

/** The e2e suite's header for a canned chat turn (no model spend), beside `E2E_BYPASS_TOKEN`. */
export const CHAT_STUB_HEADER = "x-harness-stub";

export const MCP_TOOL_GROUPS = [
  "pipelines",
  "runs",
  "records",
  "knowledge",
  "skills",
  "audit",
  "sandbox",
] as const;

export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];

export const MCP_TOOL_GROUP_LABEL: Record<McpToolGroup, string> = {
  pipelines: "Pipelines",
  runs: "Runs",
  records: "Records",
  knowledge: "Knowledge base",
  skills: "Skills and Rules",
  audit: "Audit trail",
  sandbox: "Sandbox",
};

/** One tool on the Harness MCP server. */
export type McpToolSpec = {
  /** snake_case, as the model calls it. */
  name: string;
  title: string;
  /** Written for a model: what it does and when to use it. */
  description: string;
  /** What the Staff member's Role must allow; null when any Staff member may. */
  permission: Action | null;
  group: McpToolGroup;
  /** True when it changes nothing. */
  readOnly: boolean;
  /** Set on a Pipeline's tool. */
  pipelineId?: PipelineId;
};

const PIPELINE_TOOL_PREFIX = "pipeline_";

/** A Pipeline's tool: `pipeline_member_request`. */
export function pipelineToolName(id: PipelineId): string {
  return `${PIPELINE_TOOL_PREFIX}${id}`;
}

/** The Pipeline a tool starts, or null when it is not a Pipeline's tool. */
export function pipelineOfTool(name: string): PipelineId | null {
  if (!name.startsWith(PIPELINE_TOOL_PREFIX)) return null;
  const id = name.slice(PIPELINE_TOOL_PREFIX.length);
  return isPipelineId(id) ? id : null;
}

/** Where a Run opens in the app. */
export function runLink(runId: string): string {
  return hrefOf({ tab: "pipelines", params: { run: runId } });
}

export function pipelineTool(spec: PipelineSpec): McpToolSpec {
  const approvals = spec.steps.filter((step) => step.kind === "approval");
  return {
    name: pipelineToolName(spec.id),
    title: spec.title,
    description: `${spec.summary} Starts a Run of the ${spec.title} Pipeline and returns its id and a link. The Pipeline's code decides, not you.${
      approvals.length > 0
        ? " It stops for a person's Approval; you cannot give one."
        : ""
    } Follow it with get_run, which waits for the Run to reach a person or finish.`,
    permission: "run.start",
    group: "pipelines",
    readOnly: false,
    pipelineId: spec.id,
  };
}

/** Every tool that is not a Pipeline's, in the order the server lists them. */
export const STATIC_MCP_TOOLS = [
  // Runs ---------------------------------------------------------------------
  {
    name: "list_pipelines",
    title: "List Pipelines",
    description:
      "The desk's Pipelines: what each does, the input its tool takes, its Steps in the order they run (Steps on one level run together) and which Steps wait for a person's Approval. Read it before starting a Run.",
    permission: null,
    group: "runs",
    readOnly: true,
  },
  {
    name: "get_run",
    title: "Get a Run",
    description: `A Run's status, Steps, Findings, Drafts and Approvals. While the Run is still at work it waits up to ${LIMITS.runWaitMs / 1000} seconds for it to reach an Approval or finish; if it is still running after that, call it at most once more, then say the Run carries on in the app. A pending Approval must be decided by a person in the app: say so and give the link, never claim it is approved.`,
    permission: null,
    group: "runs",
    readOnly: true,
  },
  {
    name: "list_runs",
    title: "List Runs",
    description:
      "Runs in this Workspace, newest first, with status and subject. Pass sessionId for one Session's Runs.",
    permission: null,
    group: "runs",
    readOnly: true,
  },
  {
    name: "stop_run",
    title: "Stop a Run",
    description:
      "Stops a Run that is queued, running or waiting for an Approval. Only when the person asks you to stop it.",
    permission: "run.stop",
    group: "runs",
    readOnly: false,
  },
  // Records ------------------------------------------------------------------
  {
    name: "find_members",
    title: "Find Members",
    description:
      "Finds pension plan Members by name or member number (all of them, up to the limit, when the query is empty). Optionally only one Employer's.",
    permission: null,
    group: "records",
    readOnly: true,
  },
  {
    name: "get_member",
    title: "Get a Member",
    description:
      "One Member by id or member number, with their Employer and their Member requests. Amounts are Cayman Islands dollars (CI$).",
    permission: null,
    group: "records",
    readOnly: true,
  },
  {
    name: "list_employers",
    title: "List Employers",
    description:
      "The Employers in the plan, with code and status (active, delinquent, suspended, closed).",
    permission: null,
    group: "records",
    readOnly: true,
  },
  {
    name: "get_employer",
    title: "Get an Employer",
    description:
      "One Employer by id or code, with its monthly contribution Schedules and their lines.",
    permission: null,
    group: "records",
    readOnly: true,
  },
  {
    name: "list_schedules",
    title: "List Schedules",
    description:
      "Contribution Schedules, newest month first, optionally for one Employer or one month (YYYY-MM).",
    permission: null,
    group: "records",
    readOnly: true,
  },
  {
    name: "list_member_requests",
    title: "List Member requests",
    description:
      "Member requests (transfer out, leaving Cayman, withdrawal for property, retirement, claim on death), newest first, optionally by kind, Member or status.",
    permission: null,
    group: "records",
    readOnly: true,
  },
  // Knowledge base -------------------------------------------------------------
  {
    name: "search_knowledge",
    title: "Search the Knowledge base",
    description:
      "Searches the Knowledge base's Passages by words and meaning. Each hit has its Source title, date and a citation id like [P123]; cite the ids you rely on. A hit marked conflictOpen is under an open Conflict: say so in the answer.",
    permission: null,
    group: "knowledge",
    readOnly: true,
  },
  {
    name: "read_source",
    title: "Read a Source",
    description:
      "A Source's Passages in order, with their citation ids. Superseded Passages are marked. Takes the Source's id (a file name of one attached in this conversation also works when it is unambiguous). A Source attached to the conversation and not yet filed has no Passages: its text is returned instead, with nothing to cite.",
    permission: null,
    group: "knowledge",
    readOnly: true,
  },
  {
    name: "list_attachments",
    title: "List attachments",
    description:
      'The Sources attached in this conversation, filed or not, with the id each tool takes. list_sources hides the ones not yet filed; use this to find "the attached paper". Only in the built-in chat.',
    permission: null,
    group: "knowledge",
    readOnly: true,
  },
  {
    name: "list_sources",
    title: "List Sources",
    description:
      "The Knowledge base's filed Sources: title, kind, date, status (reading, ready, failed) and open Conflicts. Sources attached to a conversation and not yet filed are not listed.",
    permission: null,
    group: "knowledge",
    readOnly: true,
  },
  {
    name: "add_source_text",
    title: "Add a text Source",
    description:
      "Adds text to the Knowledge base as a new Source and reads it at once, checking it for Conflicts with what is there. Only when the person asks to keep it.",
    permission: "source.add",
    group: "knowledge",
    readOnly: false,
  },
  {
    name: "file_source",
    title: "File an attached Source",
    description:
      "Reads a Source that was attached but not yet read (status pending) into the Knowledge base, and reports any Conflicts it raises.",
    permission: "source.add",
    group: "knowledge",
    readOnly: false,
  },
  {
    name: "list_conflicts",
    title: "List Conflicts",
    description:
      "Conflicts between Passages, open first, with both sides and the proposed Resolution. Only an admin settles one, in the app.",
    permission: null,
    group: "knowledge",
    readOnly: true,
  },
  // Skills and Rules -------------------------------------------------------------
  {
    name: "list_skills",
    title: "List Skills",
    description:
      "The Workspace's Skills (name, description, kind, Version). Load one with get_skill when the task calls for it.",
    permission: null,
    group: "skills",
    readOnly: true,
  },
  {
    name: "get_skill",
    title: "Get a Skill",
    description:
      "A Skill as SKILL.md text. A Rulebook comes back with the Rules its Pipeline enforces now.",
    permission: null,
    group: "skills",
    readOnly: true,
  },
  {
    name: "list_rules",
    title: "List Rules",
    description:
      "The Rules as a Run started today applies them (inForce: a plain sentence with its Outcome, Version and whether it is on; null while a Rule is not yet in force), and any change scheduled for a later date (scheduled, with what changes). Optionally one Pipeline's.",
    permission: null,
    group: "skills",
    readOnly: true,
  },
  // Audit trail -----------------------------------------------------------------
  {
    name: "list_audit",
    title: "Read the Audit trail",
    description:
      "Audit events, newest first: who did what, when, in which Session. A user sees their own Sessions' events; an admin the whole Workspace's.",
    permission: "audit.read.own",
    group: "audit",
    readOnly: true,
  },
  // Sandbox ------------------------------------------------------------------------
  {
    name: "code_write_file",
    title: "Write a file in the Sandbox",
    description:
      "Writes a text file in the Session's Sandbox (no network, 256 KB a file), for code to read.",
    permission: null,
    group: "sandbox",
    readOnly: false,
  },
  {
    name: "code_run",
    title: "Run a command in the Sandbox",
    description:
      "Runs one shell command in the Session's Sandbox (Node.js and Python, no network, 60 seconds) and returns its output and exit code. Use it to code your way to a count, a total or a check instead of doing arithmetic yourself.",
    permission: null,
    group: "sandbox",
    readOnly: false,
  },
  {
    name: "code_read_file",
    title: "Read a file in the Sandbox",
    description: "Reads a text file from the Session's Sandbox.",
    permission: null,
    group: "sandbox",
    readOnly: true,
  },
  {
    name: "code_list_files",
    title: "List files in the Sandbox",
    description: "Lists the files under a directory of the Session's Sandbox.",
    permission: null,
    group: "sandbox",
    readOnly: true,
  },
] as const satisfies readonly McpToolSpec[];

export type StaticToolName = (typeof STATIC_MCP_TOOLS)[number]["name"];

/** Every tool on the Harness MCP server: one per Pipeline, then the rest. */
export function mcpTools(
  pipelines: readonly PipelineSpec[] = PIPELINES,
): McpToolSpec[] {
  return [...pipelines.map(pipelineTool), ...STATIC_MCP_TOOLS];
}

/** Every tool on the Harness MCP server, for the Docs tab and the Connect page. */
export const MCP_TOOLS: readonly McpToolSpec[] = mcpTools();

export function mcpToolOf(
  name: string,
  tools: readonly McpToolSpec[] = MCP_TOOLS,
): McpToolSpec | null {
  return tools.find((tool) => tool.name === name) ?? null;
}

/** Whether this Staff member's Role allows the tool. */
export function toolAllowed(
  staff: Pick<Staff, "role">,
  tool: Pick<McpToolSpec, "permission">,
): boolean {
  return tool.permission === null || can(staff, tool.permission);
}
