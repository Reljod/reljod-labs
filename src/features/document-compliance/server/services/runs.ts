import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import {
  isRunId,
  type ReevaluateResponse,
  type ReviewRequest,
  type StartRunResponse,
} from "../../domain/api";
import { evaluate } from "../../domain/evaluate";
import { LIMITS, runLimitMessage } from "../../domain/limits";
import {
  checkReview,
  countOutcomes,
  diffFindings,
  needsReviewer,
} from "../../domain/review";
import { isRequirementId } from "../../domain/rulebook";
import { resolveRulebook } from "../../domain/rules";
import { OUTCOME_LABELS } from "../../domain/types";
import { findPack } from "../../packs";
import {
  asExtracted,
  findingViews,
  type RunView,
  type SessionRunView,
} from "../../view";
import type {
  AuditLog,
  Caller,
  PrescreenWorkflow,
  RunRepository,
} from "../ports";
import type { RulesService } from "./rules";

/**
 * Pre-screen runs: starting one (the only paid entry point), reading them
 * back, re-evaluating one with the Owner's current Rules and recording a
 * Reviewer's decision. Every read by id is scoped to the caller's Owner, so
 * another Owner's run answers exactly like a run that does not exist.
 */
export interface RunsService {
  /** Takes the Pre-screen caps with the run's insert, then audits and starts the workflow. */
  start(caller: Caller, packSlug: string): Promise<StartRunResponse>;
  list(owner: Owner): Promise<SessionRunView[]>;
  get(owner: Owner, runId: string): Promise<RunView>;
  /** The live run's ScanEvents, from event `from` on. */
  events(
    owner: Owner,
    runId: string,
    from: number,
  ): Promise<AsyncIterable<unknown>>;
  reevaluate(caller: Caller, runId: string): Promise<ReevaluateResponse>;
  review(caller: Caller, runId: string, input: ReviewRequest): Promise<void>;
}

const STALE_MESSAGE =
  "The run was just re-evaluated. Look at the new Evaluation and review again.";
const REEVALUATIONS_MESSAGE = `A run can be re-evaluated up to ${LIMITS.reevaluationsPerRun} times.`;
const REVIEWS_MESSAGE = `A run takes up to ${LIMITS.reviewsPerRun} Reviewer decisions.`;

export function createRunsService(ports: {
  runs: RunRepository;
  audit: AuditLog;
  workflow: PrescreenWorkflow;
  rules: RulesService;
  /** The model a new run records. */
  model: string;
}): RunsService {
  const { runs, audit, workflow, rules } = ports;

  /** A malformed id names no run, so it answers like a missing one. */
  function runIdOf(runId: string) {
    if (!isRunId(runId)) throw new NotFoundError("No such run.");
    return runId;
  }

  async function ownRun(owner: Owner, runId: string) {
    const run = await runs.load(runIdOf(runId), owner);
    if (!run) throw new NotFoundError("No such run.");
    return run;
  }

  return {
    async start(caller, packSlug) {
      const { owner, visitor } = caller;
      const pack = findPack(packSlug);
      if (!pack) throw new NotFoundError("No such Document pack.");

      // The Owner's Rules as they are now; the run keeps them (ADR 0019).
      const rulebook = resolveRulebook(await rules.states(owner));
      // The caps are taken here, in the same transaction as the insert, before anything is paid for.
      const created = await runs.create({
        packSlug: pack.slug,
        rulebook,
        declaration: pack.clientDeclaration,
        visitorHash: visitor.hash,
        owner,
        model: ports.model,
        limits: visitor.trusted
          ? null
          : {
              perVisitorPerHour: LIMITS.prescreensPerVisitorPerHour,
              perDay: LIMITS.prescreensPerDay,
            },
      });
      if ("refusal" in created) {
        throw new LimitError(runLimitMessage(created.refusal), {
          runId: await runs.latestCompletedId(pack.slug, owner),
        });
      }
      const { runId } = created;
      try {
        // Paid work starts only once its Audit event has landed.
        await audit.append({
          owner,
          runId,
          actor: caller.actor,
          action: "run.started",
          summary: `${pack.title}: ${pack.documents.length} documents, ${rulebook.requirements.length} Requirements`,
          details: {
            pack: pack.slug,
            model: ports.model,
            requirements: rulebook.requirements.length,
            editedRules: rulebook.applied
              .filter((rule) => rule.version > 0)
              .map(({ ruleId, version }) => ({ ruleId, version })),
          },
        });
        const workflowRunId = await workflow.start({
          runId,
          packSlug: pack.slug,
          kinds: pack.documents.map((document) => document.kind),
          rules: rulebook.applied,
          owner,
        });
        await runs.setWorkflowRunId(runId, workflowRunId);
      } catch (error) {
        await runs.fail(
          runId,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      return { runId };
    },

    list: (owner) => runs.list(owner),

    get: ownRun,

    async events(owner, runId, from) {
      // Another Owner's run streams nothing, as if it did not exist.
      const workflowRunId = await runs.workflowRunIdOf(runIdOf(runId), owner);
      if (!workflowRunId) throw new NotFoundError("No such run.");
      return workflow.events(workflowRunId, from);
    },

    async reevaluate(caller, runId) {
      const { owner } = caller;
      // The run and the Owner's Rules are independent reads.
      const [view, states] = await Promise.all([
        ownRun(owner, runId),
        rules.states(owner),
      ]);
      if (view.status !== "completed") {
        throw new ConflictError("Only a finished run can be re-evaluated.");
      }
      const pack = findPack(view.packSlug);
      if (!pack) throw new NotFoundError("This run's pack is gone.");
      if (view.evaluations.length - 1 >= LIMITS.reevaluationsPerRun) {
        throw new LimitError(REEVALUATIONS_MESSAGE);
      }

      const rulebook = resolveRulebook(states);
      const latest = view.evaluations.at(-1);
      if (
        latest &&
        JSON.stringify(latest.rules) === JSON.stringify(rulebook.applied)
      ) {
        throw new ConflictError(
          `Your Rules are the ones Evaluation ${latest.number} applied. Edit a Rule first.`,
        );
      }

      // Pure code over the stored readings: no model is called.
      const findings = findingViews(
        rulebook,
        evaluate({
          rulebook,
          prescreenDate: pack.prescreenDate,
          declaration: pack.clientDeclaration,
          documents: view.documents.map(asExtracted),
        }),
      );
      const changes = diffFindings(latest?.findings ?? [], findings);
      const counts = countOutcomes(findings);
      const changed =
        changes.length === 0
          ? "no Finding changed"
          : `${changes.length} Finding${changes.length === 1 ? "" : "s"} changed`;
      const recorded = await runs.recordEvaluation({
        owner,
        runId,
        rules: rulebook.applied,
        findings,
        createdBy: caller.actor.label,
        summary: `${pack.title}: ${changed} (${counts.pass} pass, ${counts.fail} fail, ${counts.needs_review} needs review)`,
        details: {
          pack: pack.slug,
          against: latest?.number ?? null,
          counts,
          changes: changes.map(({ requirementId, from, to }) => ({
            requirementId,
            from,
            to,
          })),
          editedRules: rulebook.applied
            .filter((rule) => rule.version > 0)
            .map(({ ruleId, version }) => ({ ruleId, version })),
        },
        max: LIMITS.reevaluationsPerRun,
      });
      if ("refusal" in recorded) {
        if (recorded.refusal === "limit")
          throw new LimitError(REEVALUATIONS_MESSAGE);
        throw new NotFoundError("No such run.");
      }
      return { number: recorded.number, changes };
    },

    async review(caller, runId, input) {
      const { owner } = caller;
      const { requirementId, evaluation } = input;
      if (!isRequirementId(requirementId)) {
        throw new InvalidError("No such Requirement.");
      }
      const checked = checkReview(input);
      if (!checked.ok) throw new InvalidError(checked.message);

      const view = await ownRun(owner, runId);
      if (view.status !== "completed") {
        throw new ConflictError("Only a finished run can be reviewed.");
      }
      const latest = view.evaluations.at(-1);
      // A decision stands on the Finding the Reviewer read; if a re-evaluation
      // has replaced it since, they must look again. The database checks the
      // same under the run lock, for a re-evaluation that lands after this load.
      if (!latest || latest.number !== evaluation) {
        throw new ConflictError(STALE_MESSAGE);
      }
      const finding = latest.findings.find(
        (item) => item.requirementId === requirementId,
      );
      if (!finding) {
        throw new NotFoundError("The latest Evaluation has no such Finding.");
      }
      if (!needsReviewer(finding.outcome)) {
        throw new InvalidError("A passing Finding needs no Reviewer.");
      }
      if (view.reviews.length >= LIMITS.reviewsPerRun) {
        throw new LimitError(REVIEWS_MESSAGE);
      }

      const verb =
        finding.outcome === checked.outcome ? "Confirmed" : "Overrode";
      const refused = await runs.recordReview({
        owner,
        runId,
        evaluation,
        requirementId,
        findingOutcome: finding.outcome,
        outcome: checked.outcome,
        note: checked.note,
        reviewer: caller.actor.label,
        summary: `${verb} "${finding.title}": ${OUTCOME_LABELS[finding.outcome]} → ${OUTCOME_LABELS[checked.outcome]}`,
        details: {
          requirementId,
          evaluation: latest.number,
          from: finding.outcome,
          to: checked.outcome,
          note: checked.note,
        },
        max: LIMITS.reviewsPerRun,
      });
      if (refused?.refusal === "limit") throw new LimitError(REVIEWS_MESSAGE);
      if (refused?.refusal === "gone") throw new NotFoundError("No such run.");
      if (refused?.refusal === "stale") throw new ConflictError(STALE_MESSAGE);
    },
  };
}
