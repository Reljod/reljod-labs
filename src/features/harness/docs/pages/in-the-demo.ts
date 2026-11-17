import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "in-the-demo",
  section: "introduction",
  title: "What is in the demo, and what is fictional",
  summary:
    "The six tabs and Demo mode, the Pensions Operations Desk, and a plain statement of what is made up.",
  body: [
    md`
## What is in it

The demo lives at §/demos/harness§ and has six tabs plus Demo mode.

| Tab | What it is for |
| --- | --- |
| Chat | Talk to the Agent in a Session. Attach files, start Pipelines, watch run cards. |
| Pipelines | Watch a Run live, read its Findings and Drafts, give or return an Approval. |
| Knowledge | Sources, Passages, search and Conflicts. |
| Skills | Edit Skills as text and Rules as cards. Every save is a Version. |
| Audit | The Audit trail of your Sessions, or of the whole Workspace for an admin. |
| Docs | This documentation. |

**Demo mode** walks you through the real app one press at a time. See [Demo mode](#doc:demo-mode).

You can also reach the same tools from Claude. See [Connect Claude in five minutes](#doc:connect-claude-quick).

## The first desk

The first desk is the **Pensions Operations Desk** of a bank. It has records (Employers, Members, Schedules, Remittances, Member requests), three Pipelines and one Skill that answers Member questions. See [The desk and its records](#doc:desk-records).

## What is fictional

- **The bank is fictional.** Harbour Bank & Trust does not exist. Its Employers, Members and Staff are made up. No real bank, employer or person appears.
- **Every document is a SPECIMEN.** Sample files carry a SPECIMEN watermark.
- **The Rules are illustrative.** They follow the published shape of the Cayman National Pensions Act. They are not legal advice and must not be used to decide a real pension case. See [The rules reference and its limits](#doc:rules-reference).
- **Your Workspace is private.** It is created with seed data the first time you open the Harness. Nothing in it is visible to another visitor.

## What is real

- The models are real, and they cost money. That is why the demo opens only to a Host or a Guest on a live Guest pass.
- The MCP server, the OAuth sign-in, the Audit trail, the Pipelines and the Sandbox are real software, running as described in [Architecture](#doc:arch-overview).
`,
  ],
};
