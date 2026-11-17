import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "demo-mode",
  section: "get-started",
  title: "Demo mode",
  summary:
    "A guided way through the real app: pick a Scenario, press Next, and each press does the next thing for you.",
  body: [
    md`
Demo mode is a guided path through the real app. It is not a recording and not a simulation.

## How it works

You pick a **Scenario**. A Scenario is made of **Beats**. Each press of **Next** is one Beat: a line that says what is about to happen, and the action that does it. A Beat might upload a file, send a message, open the Pipeline view, or change Staff.

The Beats run in your own Workspace, with the live model, as the Staff member you chose. So they are audited like anything else you do, and what they create stays in your Workspace.

## Opening it

Use the Demo mode button in the header. The panel opens beside the app. You can close it at any time and carry on by hand. Nothing in the app depends on it.

## How it drives the app

Demo mode does not reach into the pages. Each tab registers a small controller when it opens, and a Beat calls it: send a message, attach a sample, open a Run, approve, open a Rule, upload to the Knowledge base, settle a Conflict, switch Staff, open a tab. A Beat that cannot run (for example because you are signed in as a Role that may not do it) stops and says why in plain words.

## Things to know

- Because the model is live, an answer can differ each time. A Beat waits for the Agent to finish, then goes on.
- A Beat that starts a Run counts against the same hourly limits as any Run. See [Limits](#doc:ref-limits).
- Demo mode adds data to your Workspace. It does not undo it. Your Workspace is private, so nobody else sees it.
`,
  ],
};
