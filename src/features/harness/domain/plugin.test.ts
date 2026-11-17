import { describe, expect, it } from "vitest";
import {
  PLUGIN_NAME,
  PluginError,
  type PluginSkill,
  pluginFiles,
  pluginOrigin,
  pluginVersion,
  skillFolders,
} from "./plugin";
import { parseSkillMd } from "./skills";

const skills: PluginSkill[] = [
  {
    id: "member-request",
    name: "member-request",
    description: "Use when a Member asks: runs the Pipeline.",
    body: "# Steps\n\n1. Do it.",
    version: 0,
  },
  {
    id: "desk-conventions",
    name: "desk-conventions",
    description: "Use always.",
    body: "Be brief.",
    version: 2,
  },
];

describe("pluginFiles", () => {
  const files = pluginFiles({ skills, origin: "https://labs.example.com/" });

  it("lays out the plugin the way Claude Code reads it", () => {
    expect(Object.keys(files).sort()).toEqual([
      ".claude-plugin/plugin.json",
      ".mcp.json",
      "README.md",
      "skills/desk-conventions/SKILL.md",
      "skills/member-request/SKILL.md",
    ]);
  });

  it("writes a manifest with the name and a version that rises with the Skills", () => {
    const manifest = JSON.parse(files[".claude-plugin/plugin.json"] ?? "");
    expect(manifest.name).toBe(PLUGIN_NAME);
    expect(manifest.version).toBe("1.0.2");
    expect(manifest.description).toBeTruthy();
  });

  it("points an http MCP server called harness at the origin, with no token", () => {
    const mcp = JSON.parse(files[".mcp.json"] ?? "");
    expect(mcp).toEqual({
      mcpServers: {
        harness: {
          type: "http",
          url: "https://labs.example.com/api/harness/mcp",
        },
      },
    });
    expect(JSON.stringify(files)).not.toMatch(/bearer|authorization/i);
  });

  it("writes every Skill as a valid SKILL.md that is not empty", () => {
    for (const skill of skills) {
      const parsed = parseSkillMd(files[`skills/${skill.name}/SKILL.md`] ?? "");
      expect(parsed).toEqual({
        ok: true,
        skill: {
          name: skill.name,
          description: skill.description,
          body: skill.body,
        },
      });
    }
  });

  it("refuses an empty plugin or an empty Skill", () => {
    expect(() => pluginFiles({ skills: [], origin: "https://a.b" })).toThrow(
      PluginError,
    );
    expect(() =>
      pluginFiles({
        skills: [{ ...skills[0], body: "  " } as PluginSkill],
        origin: "https://a.b",
      }),
    ).toThrow(/empty/);
  });
});

describe("helpers", () => {
  it("de-duplicates folder names", () => {
    expect(skillFolders([{ name: "a" }, { name: "a" }, { name: "b" }])).toEqual(
      ["a", "a-2", "b"],
    );
  });

  it("accepts only http(s) origins and drops any path", () => {
    expect(pluginOrigin("https://x.dev/some/path?q=1")).toBe("https://x.dev");
    expect(() => pluginOrigin("javascript:alert(1)")).toThrow(PluginError);
    expect(() => pluginOrigin("not a url")).toThrow(PluginError);
  });

  it("builds the version from the Versions", () => {
    expect(pluginVersion([{ version: 0 }, { version: 3 }])).toBe("1.0.3");
  });
});
