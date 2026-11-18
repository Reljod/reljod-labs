import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "skills",
  section: "concepts",
  title: "Skills",
  summary:
    "Instructions the Agent loads when a task calls for them, in the SKILL.md format Claude uses.",
  body: [
    md`
A **Skill** is a name, a one-line description that says when to use it, and a body, in the §SKILL.md§ format Claude uses. The Agent sees only the name and the description until it loads a Skill. That keeps its instructions short and lets the Harness hold many Skills.

## The shape of a Skill

§§§markdown
---
name: member-request
description: Use when a Member asks to transfer out, withdraw or retire.
---

Steps, checks and the words to use when you report.
§§§

The name is also the folder name in the Claude Plugin. The limits are those of Claude's format:

`,
    { live: "skill-limits" },
    md`
## Defaults and Versions

Every Skill has a **Default** that ships with the Harness. An edit is saved as a new **Version** in your Workspace, never over the old one. You can put the Default back. Restoring saves a new Version too, so history is never lost.

## The Skills in this build

`,
    { live: "skills" },
    md`
## Skills that are not Pipelines

Besides a Skill and a Rulebook for each Pipeline, the Harness ships Skills for the work around them:

- §member-service-answer§: answering a Member's question with citations. See [Member service answers](#doc:member-service-answers).
- §knowledge-filing§: deciding whether an attachment is a case paper (kept with its case) or knowledge (filed in the Knowledge base).
- §desk-conventions§: tone, how to write amounts and dates, how to cite, and the guardrails every other Skill assumes.
- §sandbox-analysis§: data work in the Sandbox (counting, totalling, comparing, parsing), which the Agent does on its own judgement in any Session.

## Rulebooks

A **Rulebook** is the Skill that holds one Pipeline's Rules. It is a Skill like any other: the Agent and Claude read it as §SKILL.md§. But people edit it as Rule cards, not as text. The server renders the current Rules into the Rulebook's body, so what the Agent reads is what a Run enforces. See [Rulebooks and Rules](#doc:rulebooks-rules).

## Where Skills are used

- **In chat**, the Agent lists names and descriptions, and calls §load_skill§ for a body. Loading is an Audit event.
- **In Claude**, the Plugin carries every Skill at its current Version. See [Install the Claude Plugin](#doc:claude-plugin).
- **In the MCP server**, the tools §list_skills§ and §get_skill§ serve the same text.

To edit a Skill, see [Skills editor](#doc:app-skills). To add one, see [Add a Skill](#doc:ops-add-skill).
`,
  ],
};
