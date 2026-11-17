import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "app-skills",
  section: "using",
  title: "Skills editor",
  summary: "Read and edit Skills as text; every save is a new Version.",
  body: [
    md`
The [Skills tab](#tab:skills) holds the Workspace's Skills and Rulebooks.

## Reading

Anyone can read a Skill: its name, description, body and Version history. A Skill you have edited is marked, and shows who saved it and when.

## Editing

Only an admin can edit. Change the name, the description or the body, add a note, and save. Saving adds a **Version**; it never overwrites. The editor checks the limits of the §SKILL.md§ format before it saves:

`,
    { live: "skill-limits" },
    md`
## Putting the Default back

Restore the Default, or any earlier Version. Restoring saves a new Version, so history is kept.

## What an edit changes

- The built-in Agent reads the new Version the next time it loads the Skill.
- The Claude Plugin you download after the edit carries it. A Plugin you installed earlier does not change by itself. Download it again. See [Install the Claude Plugin](#doc:claude-plugin).
- The Audit trail records the save.

## Rulebooks

A Rulebook is a Skill, but you do not edit its body as text. You edit its Rules as cards. See [Rules editor](#doc:app-rules).
`,
  ],
};
