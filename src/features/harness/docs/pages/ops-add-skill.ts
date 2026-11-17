import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-add-skill",
  section: "operations",
  title: "Add a Skill",
  summary:
    "Write a Default in the SKILL.md format; it reaches the chat, the Plugin and the MCP server.",
  body: [
    md`
Read [Skills](#doc:skills) first.

## Add a Default

In §domain/skills/defaults.ts§, add a Skill to the list:

- §id§: lowercase letters, digits and single hyphens;
- §kind§: §skill§, or §rulebook§ for the Skill that holds a Pipeline's Rules;
- §pipelineId§: the Pipeline it describes, if any;
- §name§, §description§ and §body§, within the limits of the format.

The description is what the Agent sees before it loads the Skill. Write it as "Use when ..." and say what the task is. A vague description means the Skill is never loaded.

## Write the body

- Say when to use it and what to do, in steps.
- Name the tools to call.
- Say what the Agent must not do. For a Pipeline's Skill: never claim an Approval was given.
- Say how to cite.
- Keep it short. Long bodies cost tokens on every load.

## What you get

- The Skill is in the Skills tab, editable by an admin, with Versions.
- The built-in Agent lists it and loads it on demand.
- The MCP server serves it through §list_skills§ and §get_skill§.
- The Plugin carries it at its current Version.

## Test

The Skill's text is checked against the format's limits. Add a case to the Skill tests if the Skill has rules of its own, for example a Rulebook rendering its Rules.
`,
  ],
};
