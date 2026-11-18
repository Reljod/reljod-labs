import { describe, expect, it } from "vitest";
import {
  HARNESS_PROTECTED_RESOURCE_PATH,
  MCP_TOOLS,
  mcpToolOf,
  mcpTools,
  pipelineOfTool,
  pipelineToolName,
  runLink,
  STATIC_MCP_TOOLS,
  toolAllowed,
} from "./mcp-tools";
import { ACTIONS, can } from "./permissions";
import type { PipelineSpec } from "./pipeline";

const user = { role: "user" as const };
const admin = { role: "admin" as const };

const PIPELINE: PipelineSpec = {
  id: "member_request",
  title: "Member request",
  summary: "Handles a Member request.",
  inputSchema: [],
  steps: [
    { id: "check", title: "Check", kind: "code", after: [], summary: "" },
    {
      id: "approve",
      title: "Approve",
      kind: "approval",
      after: ["check"],
      summary: "",
      risk: "high",
    },
  ],
  skillId: "member-request",
  rulebookSkillId: "member-request-rules",
};

describe("the tool list", () => {
  it("has unique snake_case names within 64 characters", () => {
    const names = mcpTools([PIPELINE]).map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });

  it("names only real permissions", () => {
    for (const tool of MCP_TOOLS) {
      if (tool.permission) expect(ACTIONS).toContain(tool.permission);
    }
  });

  it("has no tool that gives an Approval or settles a Conflict (ADR 0013)", () => {
    for (const tool of mcpTools([PIPELINE])) {
      expect(String(tool.permission)).not.toMatch(/^approval\.|^conflict\./);
      expect(tool.name).not.toMatch(/approv|decide|resolve/);
    }
  });

  it("gives each Pipeline a tool that starts a Run and says it cannot approve", () => {
    const [tool] = mcpTools([PIPELINE]);
    expect(tool).toMatchObject({
      name: "pipeline_member_request",
      permission: "run.start",
      group: "pipelines",
      pipelineId: "member_request",
    });
    expect(tool?.description).toMatch(/cannot give one/);
    expect(pipelineToolName("delinquency_report")).toBe(
      "pipeline_delinquency_report",
    );
    expect(pipelineOfTool("pipeline_member_request")).toBe("member_request");
    expect(pipelineOfTool("pipeline_nothing")).toBeNull();
    expect(pipelineOfTool("get_run")).toBeNull();
  });

  it("links a Run to the Pipelines tab", () => {
    expect(runLink("r1")).toBe("/demos/harness?tab=pipelines&run=r1");
  });

  it("points the 401 at the Harness's own resource metadata", () => {
    expect(HARNESS_PROTECTED_RESOURCE_PATH).toBe(
      "/.well-known/oauth-protected-resource/api/harness/mcp",
    );
  });
});

describe("the permission matrix", () => {
  const expected: Record<string, { user: boolean; admin: boolean }> = {
    list_pipelines: { user: true, admin: true },
    get_run: { user: true, admin: true },
    list_runs: { user: true, admin: true },
    stop_run: { user: true, admin: true },
    find_members: { user: true, admin: true },
    get_member: { user: true, admin: true },
    list_employers: { user: true, admin: true },
    get_employer: { user: true, admin: true },
    list_schedules: { user: true, admin: true },
    list_member_requests: { user: true, admin: true },
    search_knowledge: { user: true, admin: true },
    read_source: { user: true, admin: true },
    list_attachments: { user: true, admin: true },
    list_sources: { user: true, admin: true },
    add_source_text: { user: true, admin: true },
    file_source: { user: true, admin: true },
    list_conflicts: { user: true, admin: true },
    list_skills: { user: true, admin: true },
    get_skill: { user: true, admin: true },
    list_rules: { user: true, admin: true },
    list_audit: { user: true, admin: true },
    code_write_file: { user: true, admin: true },
    code_run: { user: true, admin: true },
    code_read_file: { user: true, admin: true },
    code_list_files: { user: true, admin: true },
    pipeline_member_request: { user: true, admin: true },
  };

  it("covers every tool", () => {
    expect(
      mcpTools([PIPELINE])
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(Object.keys(expected).sort());
    expect(STATIC_MCP_TOOLS.length).toBe(Object.keys(expected).length - 1);
  });

  for (const [name, allowed] of Object.entries(expected)) {
    it(`${name}: user ${allowed.user}, admin ${allowed.admin}`, () => {
      const tool = mcpToolOf(name, mcpTools([PIPELINE]));
      if (!tool) throw new Error(`no tool ${name}`);
      expect(toolAllowed(user, tool)).toBe(allowed.user);
      expect(toolAllowed(admin, tool)).toBe(allowed.admin);
      if (tool.permission) {
        expect(toolAllowed(user, tool)).toBe(can(user, tool.permission));
      }
    });
  }
});
