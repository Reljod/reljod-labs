import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "quickstart",
  section: "get-started",
  title: "Quickstart in the app",
  summary:
    "From first open to a read Audit trail: start a Session, run a Pipeline, approve as the admin.",
  body: [
    md`
This takes about ten minutes. You need Access to the demos: a Host account or a Guest code.

## 1. Open the Harness

Go to §/demos/harness§. The first time, the Harness creates your private Workspace and seeds it with Staff, records and Knowledge base Sources. That takes a moment.

## 2. Pick a Staff member

You start as the first Staff member with the Role **user**. The Staff switcher in the header shows who you are. Open it to see everyone in your Workspace:

`,
    { live: "staff" },
    md`
You can switch at any time. Your choice only changes who you act as inside your own Workspace. See [Staff switcher](#doc:app-staff).

## 3. Start a Session

Open [the Chat tab](#tab:chat) and start a new Session. A Session is one conversation with the Agent, with its own uploads, Runs and Audit trail. You can have several at once.

## 4. Attach a sample

Attach one of the sample case papers to your message. They are SPECIMEN documents of the fictional bank. Then ask the Agent to do something with it, for example:

> Please handle the attached member request.

The Agent reads the attachment, loads the Skill that matches, and starts a Pipeline.

## 5. Run a Pipeline and view it live

When the Agent starts a Run, a **run card** appears in the chat. Choose **View pipeline** on it. The [Pipelines tab](#tab:pipelines) shows the Steps as they work. Steps on the same level run at the same time. Each Finding appears as its Step finishes, with the values it compared and the Rule Version.

## 6. Approve as the admin

The Run stops at an **Approval** and shows the Draft. A low-risk Approval can be given by you as a user. A high-risk one (a payment instruction, a rejection, a regulator report) needs an admin who did not start the Run:

1. Open the Staff switcher and choose the admin, the Operations Manager.
2. Open the Run from the Pipelines tab (the run card in the Session still links to it).
3. Read the Draft and the Findings, then approve it or return it.

If you try to approve your own high-risk Run, the server refuses and says why. That is the four-eyes rule at work.

## 7. Read the Audit trail

Open [the Audit tab](#tab:audit). Every step you took is there: the message, the file upload, the tool calls, each Step, each Finding, the Approval and who gave it. Agent events show the model, the tokens and the cost. As the admin you see the whole Workspace's trail. As a user you see your own Sessions'.

## What to try next

- Edit a Rule in [the Skills tab](#tab:skills), run the same case again, and compare the Findings. See [Rules editor](#doc:app-rules).
- Upload a document that disagrees with one in the Knowledge base and settle the Conflict. See [Conflicts and Resolutions](#doc:conflicts).
- Let Demo mode drive. See [Demo mode](#doc:demo-mode).
- Connect Claude. See [Connect Claude in five minutes](#doc:connect-claude-quick).
`,
  ],
};
