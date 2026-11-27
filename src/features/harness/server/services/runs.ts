import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { LIMITS } from "../../domain/limits";
import { approvalRefusal } from "../../domain/permissions";
import type { PipelineId } from "../../domain/pipeline";
import { rulesNotInForce, ruleVersionsOf } from "../../domain/pipelines/apply";
import { pipelineOf, subjectOf } from "../../domain/pipelines/index";
import { parseRunInput, sourceIdsOf } from "../../domain/pipelines/input";
import {
  type ApprovalDecision as Decision,
  isRunActive,
  type RunEvent,
  type RunSummary,
  type RunView,
  type StartedVia,
} from "../../domain/run";
import { assertCan } from "../errors";
import type { ApprovalAnswer, RunContext } from "../pipelines/types";
import type {
  Actor,
  AuditLog,
  HarnessRate,
  PaidActor,
  RuleRepository,
  RunRepository,
  RunSources,
  Workflows,
} from "../ports";
import type { SessionService } from "./sessions";

const NOT_HERE = "That Run is not in this Workspace.";
const SCHEDULE_FORMATS = /\.(csv|xlsx)$/i;
/** How long a Run that is over may go quiet before its replay ends. */
const IDLE_MS = 2500;

/**
 * Runs of a Pipeline on the Workflow SDK. The Pipelines tab, the chat and
 * the MCP server all reach a Run through here. The Agent approves nothing:
 * there is no tool for `decide`.
 */
export interface RunService {
  /**
   * Starts a Run and returns it as it stands (queued, every Step pending).
   * Checks the Role, the input and that its papers are the Owner's, holds
   * the Workspace to `LIMITS.maxConcurrentRuns`, takes one of the visitor's
   * Runs this hour (after the cheap refusals, before anything is saved),
   * snapshots the Rule Versions and writes `run.started` with the Run.
   */
  start(
    actor: PaidActor,
    request: {
      pipelineId: PipelineId;
      input: Record<string, unknown>;
      /** Only the Staff member's own; null when Claude starts it over MCP. */
      sessionId: string | null;
      via: StartedVia;
    },
  ): Promise<RunView>;
  get(actor: Actor, runId: string): Promise<RunView>;
  list(
    actor: Actor,
    filter?: { sessionId?: string | null; limit?: number },
  ): Promise<RunSummary[]>;
  /**
   * The escape hatch: cancelling the workflow is best effort, and the Run is
   * always marked `stopped`, so a Run whose workflow died can still be
   * cleared. A Run that has ended is returned unchanged.
   */
  stop(actor: Actor, runId: string): Promise<RunView>;
  /**
   * A person approves or returns a Draft, which resumes the Run. High risk
   * needs an admin who did not start the Run (`approvalRefusal`, four
   * eyes); only a pending Approval of an active Run can be decided, once.
   */
  decide(
    actor: Actor,
    approvalId: string,
    decision: Decision,
    note?: string | null,
  ): Promise<RunView>;
  /**
   * The Run's events from number `from`. Resolves once the Run is found
   * (404 otherwise); the first event is `run.started`, the last
   * `run.finished`. A Run that is over but whose stream nobody closed (its
   * workflow died) ends with a `run.finished` made from its row.
   */
  events(
    actor: Actor,
    runId: string,
    from: number,
  ): Promise<AsyncGenerator<RunEvent>>;
}

export function createRunService(ports: {
  runs: RunRepository;
  sources: RunSources;
  rules: Pick<RuleRepository, "statesAsOf">;
  sessions: Pick<SessionService, "writable">;
  workflows: Workflows;
  rate: HarnessRate;
  audit: AuditLog;
  /** The bank's day (Cayman), which Rules and deadlines are read on. */
  today: () => string;
  /** Model Steps use their deterministic fallbacks (the stubbed e2e suite). */
  stubSteps: boolean;
}): RunService {
  const { runs, workflows } = ports;

  const tooMany = (active: number) =>
    new LimitError(
      `${active} Runs are already at work in this Workspace (at most ${LIMITS.maxConcurrentRuns}). Let one finish or stop it first.`,
    );

  async function view(owner: Owner, runId: string): Promise<RunView> {
    const run = await runs.view(owner, runId);
    if (!run) throw new NotFoundError(NOT_HERE);
    return run;
  }

  return {
    async start(actor, request) {
      const { owner, staff, visitor } = actor;
      assertCan(staff, "run.start");
      const spec = pipelineOf(request.pipelineId);
      if (!spec)
        throw new InvalidError(
          `There is no Pipeline called "${String(request.pipelineId)}".`,
        );
      const asOf = ports.today();
      const parsed = parseRunInput(spec.id, request.input, asOf);
      if (!parsed.ok) throw new InvalidError(parsed.message);

      const ids = sourceIdsOf(parsed.input);
      // Independent reads, together: the papers, the Session, the places taken.
      const [sources, session, busy] = await Promise.all([
        ports.sources.meta(owner, ids),
        request.sessionId
          ? ports.sessions.writable(actor, request.sessionId)
          : null,
        runs.busy(owner),
      ]);
      if (sources.length !== ids.length) {
        throw new NotFoundError(
          "A paper given to the Run is not in this Workspace.",
        );
      }
      if (spec.id === "contribution_processing") {
        const [schedule] = sources;
        const looksRight =
          schedule &&
          (["csv", "sheet"].includes(schedule.kind) ||
            SCHEDULE_FORMATS.test(schedule.storagePath ?? ""));
        if (!looksRight)
          throw new InvalidError("A Schedule must be a CSV or XLSX file.");
      }
      const sessionId = session?.id ?? null;
      // A full Workspace is refused before one of the visitor's Runs this
      // hour is spent; the insert checks again under the lock.
      if (busy >= LIMITS.maxConcurrentRuns) throw tooMany(busy);
      await ports.rate.take("run", visitor, { owner });
      // Each Rule as of the Run's date: a Version scheduled for later does
      // not apply yet, and `rule_versions` records the Versions applied.
      const states = await ports.rules.statesAsOf(owner, spec.id, asOf);
      const ruleVersions = ruleVersionsOf(states);
      const notInForce = rulesNotInForce(states);
      const stubbed = ports.stubSteps;

      const saved = await runs.insert({
        owner,
        sessionId,
        pipelineId: spec.id,
        input: parsed.input,
        ruleVersions,
        startedBy: staff.id,
        via: request.via,
        stepIds: spec.steps.map((step) => step.id),
        max: LIMITS.maxConcurrentRuns,
        event: (runId) => ({
          owner,
          actor: { kind: "staff", staff },
          action: "run.started",
          summary: `Started ${spec.title}: ${subjectOf(spec.id, parsed.input, null)}`,
          sessionId,
          runId,
          target: { kind: "run", id: runId },
          detail: {
            pipelineId: spec.id,
            via: request.via,
            input: parsed.input,
            asOf,
            ruleVersions,
            ...(notInForce.length > 0 ? { notInForce } : {}),
            stubbed,
          },
        }),
      });
      if ("busy" in saved) throw tooMany(saved.busy);
      const { runId } = saved;

      const ctx: RunContext = {
        runId,
        owner,
        sessionId,
        pipelineId: spec.id,
        input: parsed.input,
        asOf,
        stubbed,
        states,
        startedBy: { id: staff.id, name: staff.name },
        startedVia: request.via,
      };
      try {
        await runs.setWorkflow(owner, runId, await workflows.start(ctx));
      } catch (error) {
        await runs.setStatus(owner, runId, "failed", {
          error: "The Run could not be started.",
        });
        await ports.audit.record({
          owner,
          actor: { kind: "system" },
          action: "run.finished",
          summary: "Run failed: the workflow could not be started.",
          sessionId,
          runId,
          target: { kind: "run", id: runId },
          detail: { pipelineId: spec.id, status: "failed" },
        });
        throw error;
      }
      return view(owner, runId);
    },

    get: (actor, runId) => view(actor.owner, runId),

    list: (actor, filter = {}) => runs.list(actor.owner, filter),

    async stop(actor, runId) {
      const { owner, staff } = actor;
      assertCan(staff, "run.stop");
      const row = await runs.row(owner, runId);
      if (!row) throw new NotFoundError(NOT_HERE);
      if (!isRunActive(row.status)) return view(owner, row.id);
      const why = `Stopped by ${staff.name}.`;
      if (row.workflow_run_id) {
        await workflows
          .cancel(row.workflow_run_id, `Stopped by ${staff.name}`)
          .catch(() => {
            // The workflow already ended or died without updating the row: stop the row anyway.
          });
      }
      await runs.markStopped(owner, row.id, why);
      if (row.workflow_run_id) {
        await workflows.close(row.workflow_run_id, {
          type: "run.finished",
          status: "stopped",
          result: null,
          error: why,
        });
      }
      await ports.audit.record({
        owner,
        actor: { kind: "staff", staff },
        action: "run.stopped",
        summary: `Stopped the Run: ${subjectOf(row.pipeline_id, row.input ?? {}, row.result)}`,
        sessionId: row.session_id,
        runId: row.id,
        target: { kind: "run", id: row.id },
        detail: { pipelineId: row.pipeline_id, was: row.status },
      });
      return view(owner, row.id);
    },

    async decide(actor, approvalId, decision, rawNote) {
      const { owner, staff } = actor;
      if (decision !== "approve" && decision !== "return") {
        throw new InvalidError("Approve or return the Draft.");
      }
      const note = rawNote?.trim().slice(0, 1000) || null;
      const { claim, applied } = await runs.decide(
        owner,
        approvalId,
        (found) => {
          if (!found)
            throw new NotFoundError("That Approval is not in this Workspace.");
          const refusal = approvalRefusal(staff, {
            risk: found.risk,
            startedBy: found.startedBy,
          });
          if (refusal) throw new ForbiddenError(refusal);
          if (found.status !== "pending") {
            throw new ConflictError(
              found.status === "expired"
                ? "This Approval has expired: its Run was stopped or waited too long."
                : `This Approval was already ${found.status}.`,
            );
          }
          if (!isRunActive(found.runStatus) || !found.hookToken) {
            throw new ConflictError(
              "This Run has ended; its Approval can no longer be decided.",
            );
          }
          return {
            status: decision === "approve" ? "approved" : "returned",
            note,
            decidedBy: staff.id,
            event: {
              owner,
              actor: { kind: "staff", staff },
              action: "approval.decided",
              summary: `${decision === "approve" ? "Approved" : "Returned"} ${found.risk}-risk ${found.title}`,
              sessionId: found.sessionId,
              runId: found.runId,
              target: { kind: "approval", id: found.id },
              detail: { decision, risk: found.risk, kind: found.kind, note },
            },
          };
        },
      );
      if (!applied)
        throw new ConflictError("This Approval was decided a moment ago.");

      const answer: ApprovalAnswer = {
        approvalId: claim.id,
        decision,
        note,
        decidedBy: { id: staff.id, name: staff.name },
      };
      try {
        await workflows.resume(claim.hookToken as string, answer);
      } catch (error) {
        // The decision stands; the Run whose workflow is gone is closed so it does not hold a place.
        console.error(
          "[harness] could not resume the Run",
          error instanceof Error ? error.message : error,
        );
        const why = "The Run could not be resumed after the decision.";
        const moved = await runs.setStatus(owner, claim.runId, "failed", {
          error: why,
        });
        if (moved && claim.workflowRunId) {
          await workflows.close(claim.workflowRunId, {
            type: "run.finished",
            status: "failed",
            result: null,
            error: why,
          });
        }
      }
      return view(owner, claim.runId);
    },

    async events(actor, runId, from) {
      const { owner } = actor;
      const row = await runs.row(owner, runId);
      if (!row) throw new NotFoundError(NOT_HERE);
      const start = Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0;
      const over = !isRunActive(row.status);
      const final = (seq: number): RunEvent => ({
        seq,
        at: new Date().toISOString(),
        type: "run.finished",
        status:
          row.status === "completed" ||
          row.status === "returned" ||
          row.status === "stopped"
            ? row.status
            : "failed",
        result: row.result,
        error: row.error,
      });

      if (!row.workflow_run_id) {
        // Never reached the workflow (it failed to start): the row is all there is.
        const run = await view(owner, row.id);
        const events: RunEvent[] = [
          { seq: 0, at: run.createdAt, type: "run.started", run },
        ];
        if (over) events.push(final(1));
        return (async function* () {
          yield* events.slice(start);
        })();
      }

      const reader = workflows.reader(row.workflow_run_id, start);
      return (async function* () {
        let seq = start;
        try {
          for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const idle = new Promise<"idle">((resolve) => {
              if (over) timer = setTimeout(() => resolve("idle"), IDLE_MS);
            });
            const next = await Promise.race([reader.read(), idle]);
            clearTimeout(timer);
            if (next === "idle" || next.done) {
              if (over) yield final(seq);
              return;
            }
            const event = { ...next.value, seq: seq++ } as RunEvent;
            yield event;
            if (event.type === "run.finished") return;
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
      })();
    },
  };
}
