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

Each Step is a durable step. A Step whose own code fails is not retried: a failed check will fail again, and a model Step costs money each try. The Step is marked §failed§ with a message a person can read, and the Run ends §failed§. Only a lost connection is retried, twice. A Step may also be marked §skipped§ when an earlier Finding made it unnecessary. A Step that reads several papers or drafts several chasers does one piece of work per item inside itself.
`,
    { diagram: "run-life" },
    md`
## The events stream

The workflow writes **Run events** to a durable stream, one JSON object per line: §run.started§, §step.started§, §step.finished§, §step.failed§, §finding§, §draft§, §approval.requested§, §approval.decided§ and §run.finished§. Steps of one level write to the same stream at the same moment, so no Step can know an event's place in it. Each event is numbered, in §seq§, by its position in the stream when it is read, counting up from 0.

The route §GET /api/harness/runs/<id>/events?from=<seq>§ replays the stream from a position, as one JSON object per line. The browser applies events with a pure reducer. Replaying a tail that overlaps what it already applied gives the same state, so a reconnect is safe. A watcher that arrives late sees the whole Run.

The database holds the Run's state too (§runs§, §run_steps§, §findings§, §approvals§), written as the workflow goes. The stream is for watching, the tables are for listing and for the Audit trail.

## Approvals are hooks

When a Run reaches an Approval Step, the workflow creates a **hook**, saves its token on the §approvals§ row and waits. The Run's status is §waiting_approval§. Nothing is running while it waits.

When a person decides, §POST /api/harness/approvals/<id>/decide§ checks the Role and the four-eyes rule with the one function that decides it, records the decision, and resumes the hook. The Run continues, or ends §returned§.

**An Approval waits 24 hours.** If nobody decides by then, the Approval is marked §expired§, the stream records §approval.decided§ with that status, and the Run ends §stopped§ with the message "The Approval was not decided in time." A decision that lands in the same moment wins.

## A stale Run

A Run whose workflow died would otherwise hold one of the Workspace's places for ever. When a new Run starts, the server first sweeps the Workspace: a Run that has been queued or running with no update for an hour is marked §failed§ ("The Run lost its workflow."), and a Run that has been waiting for an Approval for 25 hours (a little longer than the wait) is marked §stopped§. Both then stop counting among the Runs at work.

## Stopping

§POST /api/harness/runs/<id>/stop§ always works, whatever state the workflow is in. It ends the Run §stopped§ in the database and the stream.

## Limits

- Runs a visitor may start in an hour: counted in the server function, so a Run from chat, the app, Demo mode or an MCP client all count.
- Runs at work in a Workspace at once.

See [Limits](#doc:ref-limits).

## Dates and ended Runs

Dates follow the Cayman day (UTC-5, no daylight saving), not the server's. A Run started at 02:00 UTC is still the evening before in George Town, and that is the day its Rules and deadlines are read on. The Run applies, for each Rule, the Version in force on that day (see [Rules editor](#doc:app-rules)).

A Run that has ended (stopped, failed or swept as stale) runs no further paid Step: each Step checks that its Run is still active before it does paid work, and ends the workflow if not.

## Determinism

Code Steps are pure functions of the case facts and the Rule Versions the Run took when it started. The same input and the same Versions give the same Findings. Model Steps are not deterministic, so they are never allowed to produce a Finding.
`,
  ],
};
