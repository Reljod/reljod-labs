import { API_ROOT, ROUTES } from "../domain/api";
import { AUDIT_ACTIONS } from "../domain/audit";
import { LIMITS, type LimitName } from "../domain/limits";
import {
  MCP_TOOL_GROUP_LABEL,
  MCP_TOOL_GROUPS,
  MCP_TOOLS,
} from "../domain/mcp-tools";
import { ACTIONS, type Action, can, roleNeeded } from "../domain/permissions";
import { levels, type PipelineSpec } from "../domain/pipeline";
import { PIPELINES } from "../domain/pipelines";
import { MEMBER_REQUEST_LABEL } from "../domain/records";
import { OUTCOME_LABEL, OUTCOMES, type ParameterSpec } from "../domain/rules";
import { RULE_SPECS } from "../domain/rules/defaults";
import { RUN_STATUSES, type RunStatus } from "../domain/run";
import { SANDBOX_LIMITS } from "../domain/sandbox";
import { SKILL_DEFAULTS, SKILL_LIMITS } from "../domain/skills";
import { ROLE_LABEL, SEED_STAFF } from "../domain/staff";
import type { LiveId } from "./types";

/*
 * Tables the Docs build from the registries at render time. Nothing here
 * copies a list: a new tool, Rule, limit or audit action shows up in the Docs
 * the moment it is added in code. What is written here is only prose about
 * each entry, and TypeScript refuses to compile when a new Action, limit or
 * Run status has no sentence.
 */

/** A Markdown table cell: pipes and line breaks would break the row. */
function cell(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export function table(
  head: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [
    line(head.map(cell)),
    line(head.map(() => "---")),
    ...rows.map((row) => line(row.map(cell))),
  ].join("\n");
}

const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

/** Shown where a registry has no entries (a build that has not registered any yet). */
const NOTHING = (what: string) =>
  `_No ${what} are registered in this build. This list is read from the code, so it fills in as they are added._`;

// Permissions ---------------------------------------------------------------------

const ACTION_TEXT: Record<Action, string> = {
  "session.create": "Open a Session.",
  "run.start": "Start a Run of a Pipeline.",
  "run.stop": "Stop a Run that is still at work.",
  "approval.decide.low": "Give or return a low-risk Approval.",
  "approval.decide.high":
    "Give or return a high-risk Approval (and not on a Run you started).",
  "skill.edit": "Save a Skill as a new Version, or put the Default back.",
  "rule.edit": "Save a Rule as a new Version, or put the Default back.",
  "conflict.resolve": "Settle a Conflict in the Knowledge base.",
  "source.add": "Add a Source to the Knowledge base.",
  "source.remove": "Remove a Source you or someone else added.",
  "sandbox.use": "Write and run code in the Sandbox.",
  "audit.read.own": "Read the Audit trail of your own Sessions.",
  "audit.read.workspace": "Read the Audit trail of the whole Workspace.",
  "plugin.download": "Download the Claude Plugin.",
  "mcp.connect": "Connect an MCP client, such as Claude.",
};

function permissionMatrix(): string {
  const yes = (allowed: boolean) => (allowed ? "Yes" : "No");
  return table(
    ["Action", "What it covers", ROLE_LABEL.user, ROLE_LABEL.admin],
    ACTIONS.map((action) => [
      code(action),
      ACTION_TEXT[action],
      yes(can({ role: "user" }, action)),
      yes(can({ role: "admin" }, action)),
    ]),
  );
}

// MCP tools -----------------------------------------------------------------------

function roleOf(permission: Action | null): string {
  if (!permission) return "Any Staff member";
  return `${ROLE_LABEL[roleNeeded(permission)]} (${code(permission)})`;
}

function mcpTools(): string {
  if (MCP_TOOLS.length === 0) return NOTHING("MCP tools");
  const parts: string[] = [];
  for (const group of MCP_TOOL_GROUPS) {
    const tools = MCP_TOOLS.filter((tool) => tool.group === group);
    if (tools.length === 0) continue;
    parts.push(
      `### ${MCP_TOOL_GROUP_LABEL[group]}`,
      table(
        ["Tool", "What it does", "Role it needs"],
        tools.map((tool) => [
          code(tool.name),
          tool.description,
          roleOf(tool.permission),
        ]),
      ),
    );
  }
  return parts.join("\n\n");
}

// Pipelines -----------------------------------------------------------------------

const KIND_LABEL = {
  code: "Code",
  model: "Model",
  approval: "Approval",
} as const;

function pipelineOf(arg: string | undefined): PipelineSpec | null {
  return PIPELINES.find((pipeline) => pipeline.id === arg) ?? null;
}

function stepsOf(spec: PipelineSpec): string {
  const rows: string[][] = [];
  levels(spec).forEach((level, index) => {
    for (const step of level) {
      rows.push([
        String(index + 1),
        step.title,
        KIND_LABEL[step.kind],
        step.after.length > 0 ? step.after.map(code).join(", ") : "none",
        step.kind === "approval" && step.risk
          ? `${step.summary} (highest risk: ${step.risk})`
          : step.summary,
      ]);
    }
  });
  return table(["Level", "Step", "Kind", "Waits for", "What it does"], rows);
}

function pipelineSteps(arg: string | undefined): string {
  const spec = pipelineOf(arg);
  if (!spec) return NOTHING("Steps for this Pipeline");
  return `${stepsOf(spec)}\n\nSteps on the same level do not wait for each other and run at the same time.`;
}

function pipelineInputs(arg: string | undefined): string {
  const spec = pipelineOf(arg);
  if (!spec) return NOTHING("inputs for this Pipeline");
  return table(
    ["Field", "Type", "Required", "What it is"],
    spec.inputSchema.map((field) => [
      code(field.name),
      field.options ? field.options.map(code).join(", ") : field.type,
      field.required ? "Yes" : "No",
      field.description,
    ]),
  );
}

function pipelines(): string {
  if (PIPELINES.length === 0) return NOTHING("Pipelines");
  return PIPELINES.map(
    (spec) =>
      `### ${spec.title}\n\n${spec.summary}\n\nTool: ${code(`pipeline_${spec.id}`)}\n\n${stepsOf(spec)}`,
  ).join("\n\n");
}

// Rules ---------------------------------------------------------------------------

function formatParam(spec: ParameterSpec | undefined, value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (!spec) return String(value);
  switch (spec.kind) {
    case "money":
      return `CI$${Number(value).toLocaleString("en-US")}`;
    case "percent":
      return `${value}%`;
    case "days":
    case "months":
    case "years":
      return `${value} ${spec.kind}`;
    case "number":
      return spec.unit ? `${value} ${spec.unit}` : String(value);
    case "enum":
      return (
        spec.options.find((option) => option.value === value)?.label ??
        String(value)
      );
    case "list":
      return String(value);
  }
}

export function ruleSentence(spec: (typeof RULE_SPECS)[number]): string {
  return spec.sentence.replace(/\{(\w+)\}/g, (_, name: string) =>
    formatParam(spec.params[name], spec.defaults[name]),
  );
}

function rules(arg: string | undefined): string {
  const specs = RULE_SPECS.filter((rule) => !arg || rule.pipelineId === arg);
  if (specs.length === 0) return NOTHING("Rules");
  return table(
    [
      "Rule",
      "Says (with the Default values)",
      "If not met",
      "Source",
      "In effect from",
    ],
    specs.map((rule) => [
      `${rule.title} (${code(rule.id)})`,
      ruleSentence(rule),
      OUTCOME_LABEL[rule.defaultOutcome],
      rule.citation,
      rule.effectiveFrom,
    ]),
  );
}

function outcomes(): string {
  const text: Record<(typeof OUTCOMES)[number], string> = {
    block: "The case cannot proceed.",
    refer: "A person must look.",
    warn: "Noted, and the Run goes on.",
  };
  return table(
    ["Outcome", "What it does to the Run"],
    OUTCOMES.map((outcome) => [OUTCOME_LABEL[outcome], text[outcome]]),
  );
}

// Skills --------------------------------------------------------------------------

function skills(): string {
  const list = Object.values(SKILL_DEFAULTS);
  if (list.length === 0) return NOTHING("Skills");
  return table(
    ["Skill", "Kind", "Name in SKILL.md", "When the Agent uses it"],
    list.map((skill) => [
      code(skill.id),
      skill.kind === "rulebook" ? "Rulebook" : "Skill",
      code(skill.name),
      skill.description,
    ]),
  );
}

function skillLimits(): string {
  return table(
    ["Part of a SKILL.md", "Limit"],
    [
      [
        "Name",
        `At most ${SKILL_LIMITS.nameChars} characters: lowercase letters, digits and single hyphens`,
      ],
      [
        "Description",
        `At most ${SKILL_LIMITS.descriptionChars} characters, on one line`,
      ],
      [
        "Body",
        `At most ${SKILL_LIMITS.bodyChars.toLocaleString("en-US")} characters`,
      ],
    ],
  );
}

// Audit ---------------------------------------------------------------------------

function auditActions(): string {
  return table(
    ["Action", "Shown in the Audit tab as"],
    Object.entries(AUDIT_ACTIONS).map(([action, label]) => [
      code(action),
      label,
    ]),
  );
}

// Limits --------------------------------------------------------------------------

const LIMIT_TEXT: Record<LimitName, string> = {
  messagesPerHour: "Messages a visitor may send in an hour.",
  messageChars: "Characters in one message.",
  stepsPerChatTurn:
    "Model steps, tool calls included, the Agent may take in one chat turn.",
  sessionsPerWorkspace: "Sessions a Workspace keeps.",
  runsPerHour:
    "Runs a visitor may start in an hour, from the app, the chat or the MCP server.",
  maxConcurrentRuns:
    "Runs at work in a Workspace at once (queued, running or waiting for an Approval).",
  sourcesPerRun: "Sources one Run may read. Each is read by a model.",
  sourceCharsPerStep: "Characters of one Source that a model Step is given.",
  sourcesPerHour: "Sources a visitor may add in an hour.",
  sourcesPerWorkspace: "Sources a Workspace keeps, seed Sources included.",
  uploadBytes: "Size of one upload. The storage bucket repeats this cap.",
  passagesPerSource: "Passages one Source may be split into.",
  passagesCheckedPerSource:
    "New Passages of one Source checked against the old ones for Conflicts.",
  searchesPerHour:
    "Knowledge searches with a new query (each embeds the query) a visitor may make in an hour. Past it, search goes on by words alone.",
  sandboxCommandsPerHour: "Sandbox commands a visitor may run in an hour.",
  runWaitMs:
    "Milliseconds get_run waits for a Run still at work to reach an Approval or finish, so the Agent does not poll.",
  auditPageSize: "Audit events one page of the trail returns.",
};

function limitValue(name: LimitName): string {
  const value = LIMITS[name];
  if (name === "uploadBytes") return `${value / (1024 * 1024)} MB`;
  return value.toLocaleString("en-US");
}

function limits(): string {
  return table(
    ["Limit", "Value", "What it caps"],
    (Object.keys(LIMITS) as LimitName[]).map((name) => [
      code(name),
      limitValue(name),
      LIMIT_TEXT[name],
    ]),
  );
}

function sandboxLimits(): string {
  return table(
    ["Limit", "Value in the app", "What it means"],
    [
      [
        "Command time",
        `${SANDBOX_LIMITS.commandSeconds} seconds`,
        "A command that runs longer is cut off and reported as timed out.",
      ],
      [
        "Memory",
        `${SANDBOX_LIMITS.memoryMb} MB`,
        "The container's memory, with no swap.",
      ],
      ["CPU", `${SANDBOX_LIMITS.cpus}`, "CPUs the container may use."],
      [
        "File size",
        `${SANDBOX_LIMITS.fileBytes / 1024} KB`,
        "The most one file the Agent writes or reads may hold.",
      ],
      [
        "Output",
        `${SANDBOX_LIMITS.outputChars.toLocaleString("en-US")} characters`,
        "What the app keeps of a command's output.",
      ],
    ],
  );
}

// Routes --------------------------------------------------------------------------

function routes(): string {
  return table(
    ["Method", "Path", "What it does", "Takes", "Answers"],
    ROUTES.map((route) => [
      route.method,
      code(`${API_ROOT}${route.path}`),
      route.summary,
      route.request ? code(route.request) : "",
      code(route.response),
    ]),
  );
}

// Small ones ----------------------------------------------------------------------

function staff(): string {
  return table(
    ["Name", "Title", "Role", "Key"],
    SEED_STAFF.map((person) => [
      person.name,
      person.title,
      ROLE_LABEL[person.role],
      code(person.key),
    ]),
  );
}

const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  queued: "Accepted, not yet started.",
  running: "Steps are at work.",
  waiting_approval: "Stopped at an Approval, waiting for a person.",
  completed: "Finished, and any Approval was given.",
  returned: "A person sent the Draft back. The Run ends.",
  failed: "A Step failed after its retries.",
  stopped: "A person stopped it.",
};

function runStatuses(): string {
  return table(
    ["Status", "Meaning"],
    RUN_STATUSES.map((status) => [code(status), RUN_STATUS_TEXT[status]]),
  );
}

function memberRequestKinds(): string {
  return table(
    ["Kind", "What the Member asks"],
    Object.entries(MEMBER_REQUEST_LABEL).map(([kind, label]) => [
      code(kind),
      label,
    ]),
  );
}

/** The Markdown of a live block. */
export function liveMarkdown(live: LiveId, arg?: string): string {
  switch (live) {
    case "mcp-tools":
      return mcpTools();
    case "permissions":
      return permissionMatrix();
    case "pipelines":
      return pipelines();
    case "pipeline-inputs":
      return pipelineInputs(arg);
    case "pipeline-steps":
      return pipelineSteps(arg);
    case "rules":
      return rules(arg);
    case "skills":
      return skills();
    case "skill-limits":
      return skillLimits();
    case "audit-actions":
      return auditActions();
    case "limits":
      return limits();
    case "routes":
      return routes();
    case "sandbox-limits":
      return sandboxLimits();
    case "staff":
      return staff();
    case "outcomes":
      return outcomes();
    case "run-statuses":
      return runStatuses();
    case "member-request-kinds":
      return memberRequestKinds();
  }
}
