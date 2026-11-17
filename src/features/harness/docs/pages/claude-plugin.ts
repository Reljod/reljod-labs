import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "claude-plugin",
  section: "claude",
  title: "Install the Claude Plugin",
  summary:
    "Download the Skills of your Workspace as a Claude plugin, with the MCP server already set up.",
  body: [
    md`
The **Plugin** is the Workspace's current Skills plus the Harness MCP server's address, built as a Claude plugin. Installing it gives Claude the same Skills and tools as the built-in chat. It carries the Skills you edited, not a stale copy.

## Download

Open §<your-site>/api/harness/plugin§ while signed in, or use the download on the Connect page. You get a zip named §jod-harness-bank.zip§.

## What is inside

§§§text
jod-harness-bank/
  .claude-plugin/plugin.json
  skills/<skill-name>/SKILL.md     one folder per Skill, at its current Version
  .mcp.json                        the harness MCP server
  README.md
§§§

- Each folder name is the Skill's own name. A name used twice gets a number.
- The plugin's version is §1.0.<n>§, where §n§ is the sum of every Skill's Version now (a Default counts 0, and a Rulebook counts its Rules' Versions too). It rises whenever a Skill, or a Rule behind a Rulebook, gains a Version, so Claude picks up changes.
- §.mcp.json§ holds only the server's name, §type: "http"§ and the address, §<your-site>/api/harness/mcp§.
- **No token is stored in it.** Claude signs in to the MCP server with OAuth.

## Install in Claude Code

Unzip it and start Claude Code with the folder:

§§§bash
unzip jod-harness-bank.zip
claude --plugin-dir ./jod-harness-bank
§§§

Check it:

§§§bash
claude plugin validate ./jod-harness-bank
§§§

Then run §/mcp§, choose §harness§ and sign in. See [OAuth sign-in step by step](#doc:claude-oauth).

## Keeping it current

The Skills are a copy as of the download. After an admin edits a Skill or a Rule, download the Plugin again. The Audit trail records each download.

## Who may download it

Any Staff member. Downloading is an Audit event.

## Without the Plugin

You can connect Claude to the MCP server only. Claude can then read each Skill with §list_skills§ and §get_skill§, but it does not load them on its own the way it does installed Skills.
`,
  ],
};
