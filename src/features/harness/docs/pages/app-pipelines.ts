import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "app-pipelines",
  section: "using",
  title: "Pipeline view",
  summary:
    "Watch a Run live, read its Findings and Drafts, and give or return an Approval.",
  body: [
    md`
The [Pipelines tab](#tab:pipelines) lists Runs, newest first, and shows one Run in full.

## Opening a Run

Open a Run from the list, from **View pipeline** on a run card in Chat, or from a link Claude gave you (§?tab=pipelines&run=<id>§).

## What you see

- **Steps**, drawn by level. Steps on one level run together. Each shows its status: pending, running, done, failed or skipped.
- **Findings** as each Step finishes: met or not met, the values compared, the Rule and its Version, and its Outcome.
- **Drafts**: the letters, instructions and reports the Run prepared.
- **Approvals**: the one the Run is waiting for, or how it was decided and by whom.
- For a model Step, the model, the tokens and the cost.

The view is live. It reads the Run's event stream, and if your connection drops it asks for the events after the last one it saw, so you do not lose any.

## Giving or returning an Approval

When the Run waits, the Approval shows the Draft, its risk and who may decide it. Approve or return it, with a note if you like. The button is disabled while the write runs and shows the result where you clicked. A refusal says why: your Role, or that you started the Run. See [Approvals and four-eyes](#doc:approvals).

## Stopping a Run

A Run that is queued, running or waiting can be stopped. Stopping always works, whatever state the workflow is in, and the Run ends §stopped§.

## Starting a Run

Runs normally start from Chat or from Claude. The app can also start one, and Demo mode does. All routes count against the same hourly and concurrent limits. See [Limits](#doc:ref-limits).
`,
  ],
};
