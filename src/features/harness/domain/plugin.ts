import { renderSkillMd, type SkillText } from "./skills";

/**
 * The Claude Plugin as a map of file path → text (ADR 0013). Pure: the
 * server zips it. Layout, per Claude Code's plugin reference:
 *
 *   .claude-plugin/plugin.json   the manifest (only `name` is required)
 *   skills/<name>/SKILL.md       one folder per Skill
 *   .mcp.json                    `{ "mcpServers": { ... } }`, `type: "http"`
 *   README.md                    how to install and sign in
 *
 * No token goes in it: Claude signs in to the MCP server with OAuth.
 */

export const PLUGIN_NAME = "jod-harness-bank";
export const PLUGIN_TITLE = "Jod: Harness for Bank";
export const MCP_SERVER_NAME = "harness";
export const PLUGIN_FILENAME = `${PLUGIN_NAME}.zip`;

export type PluginSkill = SkillText & {
  id: string;
  /** The Skill's Version now (0 for the Default); the plugin's version rises with the sum. */
  version: number;
};

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginError";
  }
}

/** The address with no trailing slash, only http(s), no path, query or credentials. */
export function pluginOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new PluginError("The server address is not a URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PluginError("The server address must be http or https.");
  }
  return url.origin;
}

/** Folder names for the Skills: each Skill's own name, with `-2`, `-3` for a name used twice. */
export function skillFolders(skills: readonly Pick<SkillText, "name">[]) {
  const used = new Map<string, number>();
  return skills.map((skill) => {
    const count = (used.get(skill.name) ?? 0) + 1;
    used.set(skill.name, count);
    return count === 1 ? skill.name : `${skill.name}-${count}`;
  });
}

/** The plugin's version: it rises whenever any Skill (or a Rule behind a Rulebook) gains a Version, so Claude picks up the change. */
export function pluginVersion(skills: readonly Pick<PluginSkill, "version">[]) {
  return `1.0.${skills.reduce((sum, skill) => sum + skill.version, 0)}`;
}

export function pluginReadme(origin: string, folders: string[]): string {
  return [
    `# ${PLUGIN_TITLE}`,
    "",
    "A Claude plugin built from the Skills of one Harness Workspace, plus the Harness MCP server. Installing it gives Claude the same Skills and tools as the chat in the Harness. All data is fictional (SPECIMEN).",
    "",
    "## Install",
    "",
    "Unzip it, then start Claude Code with the folder:",
    "",
    "```",
    `claude --plugin-dir ./${PLUGIN_NAME}`,
    "```",
    "",
    "Run `claude plugin validate` on the folder to check it.",
    "",
    "## Sign in",
    "",
    `The plugin adds an MCP server called \`${MCP_SERVER_NAME}\` at ${origin}/api/harness/mcp. In Claude Code run \`/mcp\`, pick \`${MCP_SERVER_NAME}\` and follow the browser sign-in. You choose which Staff member Claude acts as on the consent page; the server checks that Staff member's Role on every call. No token is stored in this plugin.`,
    "",
    "Claude can start Pipelines, search the Knowledge base and read records. It cannot give an Approval: a person does that in the Harness.",
    "",
    "## Skills",
    "",
    ...folders.map((folder) => `- \`${folder}\``),
    "",
    "The Skills are a copy as of the download. Download again after an admin edits a Skill or a Rule.",
    "",
  ].join("\n");
}

/** Every file of the plugin. Throws a PluginError when there is no Skill, or a Skill has no text. */
export function pluginFiles(input: {
  skills: readonly PluginSkill[];
  origin: string;
}): Record<string, string> {
  const origin = pluginOrigin(input.origin);
  if (input.skills.length === 0) {
    throw new PluginError("There are no Skills to put in the plugin.");
  }
  for (const skill of input.skills) {
    if (!skill.name.trim() || !skill.description.trim() || !skill.body.trim()) {
      throw new PluginError(`The Skill "${skill.id}" is empty.`);
    }
  }
  const folders = skillFolders(input.skills);
  const files: Record<string, string> = {
    ".claude-plugin/plugin.json": `${JSON.stringify(
      {
        name: PLUGIN_NAME,
        displayName: PLUGIN_TITLE,
        version: pluginVersion(input.skills),
        description:
          "Skills and the MCP server of the Pensions Operations Desk at Harbour Bank & Trust (fictional, SPECIMEN data).",
      },
      null,
      2,
    )}\n`,
    ".mcp.json": `${JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: { type: "http", url: `${origin}/api/harness/mcp` },
        },
      },
      null,
      2,
    )}\n`,
    "README.md": pluginReadme(origin, folders),
  };
  input.skills.forEach((skill, index) => {
    files[`skills/${folders[index]}/SKILL.md`] = renderSkillMd({
      name: folders[index] as string,
      description: skill.description,
      body: skill.body,
    });
  });
  return files;
}
