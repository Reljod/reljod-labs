import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-durable-runs",
  section: "architecture",
  title: "Durable Runs on the Workflow SDK",
  summary: "Steps, parallel levels, the events stream and hooks for Approvals.",
  body: [
    md`
A Run is a workflow on the Workflow SDK. That gives the Harness four things a plain request cannot: a Run survives a restart, each Step retries on its own, progress is a stream anyone can replay, and a Run can wait for a person without holding a server.

## Steps and levels

A Pipeline is a list of Steps, each with the Steps it waits for. The workflow groups them into **levels**: a level holds the Steps whose dependencies are all in earlier levels. The Steps of one level run at the same time, and the workflow goes to the next level when all of them are done. A Pipeline is checked when it is defined: a Step that waits for itself, for a Step that does not exist, or in a loop, is refused.

Each Step is a durable step. If it fails, it retries before the Run is marked §failed§. A Step may also be marked §skipped§ when an earlier Finding made it unnecessary.
`,
    { diagram: "run-life" },
    md`
## The events stream

The workflow writes **Run events** to a durable stream, one JSON object per line: §run.started§, §step.started§, §step.finished§, §step.failed§, §finding§, §draft§, §approval.requested§, §approval.decided§ and §run.finished§. Each carries a number, §seq§, counting up from 0.

The route §GET /api/harness/runs/<id>/events?from=<seq>§ replays the stream from a number. The browser applies events with a pure reducer. Replaying a tail that overlaps what it already applied gives the same state, so a reconnect is safe. A watcher that arrives late sees the whole Run.

The database holds the Run's state too (§runs§, §run_steps§, §findings§, §approvals§), written as the workflow goes. The stream is for watching, the tables are for listing and for the Audit trail.

## Approvals are hooks

When a Run reaches an Approval Step, the workflow creates a **hook**, saves its token on the §approvals§ row and waits. The Run's status is §waiting_approval§. Nothing is running while it waits.

When a person decides, §POST /api/harness/approvals/<id>/decide§ checks the Role and the four-eyes rule with the one function that decides it, records the decision, and resumes the hook. The Run continues, or ends §returned§.

## Stopping

§POST /api/harness/runs/<id>/stop§ always works, whatever state the workflow is in. It ends the Run §stopped§ in the database and the stream.

## Limits

- Runs a visitor may start in an hour: counted in the server function, so a Run from chat, the app, Demo mode or an MCP client all count.
- Runs at work in a Workspace at once.

See [Limits](#doc:ref-limits).

## Determinism

Code Steps are pure functions of the case facts and the Rule Versions the Run took when it started. The same input and the same Versions give the same Findings. Model Steps are not deterministic, so they are never allowed to produce a Finding.
`,
  ],
};
