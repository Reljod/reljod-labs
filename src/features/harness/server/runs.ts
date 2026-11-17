import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { PipelineId } from "../domain/pipeline";
import type {
  ApprovalDecision,
  RunEvent,
  RunSummary,
  RunView,
  StartedVia,
} from "../domain/run";
import type { Actor, PaidActor } from "./actor";
import { NotBuiltError } from "./errors";

/*
 * STUB. Owned by the Pipelines slice, which replaces every body here and
 * keeps the signatures. The routes under `/api/harness/runs` and
 * `/api/harness/approvals`, the Pipelines tab, the chat and the MCP server
 * all call these and nothing else to reach a Run.
 */

/**
 * Starts a Run of a Pipeline on the Workflow SDK and returns it as it stands
 * (queued, every Step pending).
 *
 * Must: check `can(staff, "run.start")`; validate `input` against the
 * Pipeline's `inputSchema`; take one of the visitor's `LIMITS.runsPerHour`
 * (`takeRate(visitor, owner, "run")`) and hold `LIMITS.maxConcurrentRuns`
 * per Workspace; snapshot `currentRuleStates(owner)` into `runs.rule_versions`;
 * write `run.started`. `sessionId` is null when Claude starts it over MCP.
 */
export async function startRun(
  _input: PaidActor & {
    sessionId: string | null;
    pipelineId: PipelineId;
    input: Record<string, unknown>;
    via: StartedVia;
  },
): Promise<RunView> {
  throw new NotBuiltError("pipelines");
}

/** A Run with its Steps, Findings, Approvals and Drafts, or null when it is not in the Owner's Workspace. */
export async function getRun(
  _owner: Owner,
  _runId: string,
): Promise<RunView | null> {
  throw new NotBuiltError("pipelines");
}

/** The Workspace's Runs, newest first; one Session's when `sessionId` is given. Runs are not private to a Staff member. */
export async function listRuns(
  _owner: Owner,
  _filter: { sessionId?: string | null; limit?: number } = {},
): Promise<RunSummary[]> {
  throw new NotBuiltError("pipelines");
}

/**
 * Stops a Run. The escape hatch: cancelling the workflow is best effort
 * (try/catch), and the Run is always marked `stopped` locally, so a Run
 * whose workflow already died can still be cleared (conventions.md). Checks
 * `can(staff, "run.stop")` and writes `run.stopped`. Stopping a Run that has
 * ended returns it unchanged.
 */
export async function stopRun(
  _input: Actor & { runId: string },
): Promise<RunView> {
  throw new NotBuiltError("pipelines");
}

/**
 * A person approves or returns an Approval's Draft, which resumes the Run.
 *
 * Must: hold the Approval to the Owner; refuse with a ForbiddenError when
 * `approvalRefusal(staff, { risk, startedBy })` says so (high risk needs an
 * admin who did not start the Run); refuse with a StateError unless it is
 * still `pending` (claim it in the update, so a double click decides once);
 * write `approval.decided` in the same transaction (`auditIn`). There is no
 * MCP tool for this: the Agent approves nothing (ADR 0013).
 */
export async function decideApproval(
  _input: Actor & {
    approvalId: string;
    decision: ApprovalDecision;
    note?: string | null;
  },
): Promise<RunView> {
  throw new NotBuiltError("pipelines");
}

/**
 * The Run's live stream from event number `from` (0 for all of it), or null
 * when the Run is not in the Owner's Workspace. The first event is always
 * `run.started`; the stream closes after `run.finished`. The route writes it
 * out as NDJSON; the chat and the MCP server read it too.
 */
export async function runEventsStream(
  _owner: Owner,
  _runId: string,
  _from = 0,
): Promise<ReadableStream<RunEvent> | null> {
  throw new NotBuiltError("pipelines");
}
