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

## Previewing a Pipeline

Pick a Pipeline in the list to see its Steps before any Run. **Play** makes up a Run and moves it through the levels, so you can watch the shape of the Pipeline without calling a model or spending anything; the rail says "Simulation, no Run" while it plays.

## Opening a Run

Open a Run from the list, from **View pipeline** on a run card in Chat, or from a link Claude gave you (§?tab=pipelines&run=<id>§).

## What you see

- **Steps**, drawn by level, fitted to the width of the panel (on a wide screen the cards widen; on a narrow one the graph shrinks only as far as the text stays readable, then scrolls sideways). Steps on one level run together, inside a band that says how many ("4 at once"). Each shows its status: pending, running (with a shimmer and its elapsed time), done (a tick), failed, skipped, or waiting for an Approval (it glows). The lines flow toward a Step at work and settle when it finishes. A rail above the graph says which level the Run is at ("Level 3 of 7"). Motion is turned off when your system asks for reduced motion. On a screen narrower than 640 px the graph becomes a list: one block per level, in the order they run, with the Steps as rows you can tap. Pick a Step to see its output and its Findings.
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

Runs normally start from Chat or from Claude. The Pipelines tab has no Start button. The app's start call exists, and Demo mode uses it when the Agent does not start a Run (its **Start it for me** button); such a Run says it was started by Demo mode. All routes count against the same hourly and concurrent limits. See [Limits](#doc:ref-limits).
`,
  ],
};
