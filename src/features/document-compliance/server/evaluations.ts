import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { jsonb } from "@/server/postgres";
import type { AuditActor } from "../domain/audit";
import { evaluate } from "../domain/evaluate";
import {
  checkReview,
  countOutcomes,
  diffFindings,
  type FindingChange,
  LIMITS,
  needsReviewer,
  type ReviewInput,
} from "../domain/review";
import { isRequirementId } from "../domain/rulebook";
import { resolveRulebook } from "../domain/rules";
import { OUTCOME_LABELS } from "../domain/types";
import { findPack } from "../packs";
import { findingViews } from "../view";
import { sql } from "./db";
import { asExtracted, loadRun } from "./repository";
import { ownerRuleStates } from "./rules";

export type ReevaluateResult =
  | { ok: true; number: number; changes: FindingChange[] }
  | { ok: false; message: string };

const limitReached = (error: { message: string }) =>
  error.message.includes("limit_reached");
const runGone = (error: { message: string }) =>
  error.message.includes("run_not_found");

/**
 * Evaluates a finished run again with the Owner's Rules as they are now, over
 * the readings the run stored. Pure code: no model is called. The result is
 * kept as the run's next Evaluation, with a `run.reevaluated` event.
 */
export async function reevaluateRun(
  owner: Owner,
  actor: AuditActor,
  runId: string,
): Promise<ReevaluateResult> {
  const view = await loadRun(runId, owner);
  if (!view) return { ok: false, message: "No such run." };
  if (view.status !== "completed") {
    return { ok: false, message: "Only a finished run can be re-evaluated." };
  }
  const pack = findPack(view.packSlug);
  if (!pack) return { ok: false, message: "This run's pack is gone." };
  if (view.evaluations.length - 1 >= LIMITS.reevaluationsPerRun) {
    return {
      ok: false,
      message: `A run can be re-evaluated up to ${LIMITS.reevaluationsPerRun} times.`,
    };
  }

  const rulebook = resolveRulebook(await ownerRuleStates(owner));
  const latest = view.evaluations.at(-1);
  if (
    latest &&
    JSON.stringify(latest.rules) === JSON.stringify(rulebook.applied)
  ) {
    return {
      ok: false,
      message: `Your Rules are the ones Evaluation ${latest.number} applied. Edit a Rule first.`,
    };
  }

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
  const summary = `${pack.title}: ${changes.length === 0 ? "no Finding changed" : `${changes.length} Finding${changes.length === 1 ? "" : "s"} changed`} (${counts.pass} pass, ${counts.fail} fail, ${counts.needs_review} needs review)`;
  const details = {
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
  };
  const db = sql();
  try {
    const [row] = await db<{ number: number }[]>`
      select document_compliance.record_evaluation(
        p_owner => ${owner},
        p_run_id => ${runId}::uuid,
        p_rules_applied => ${jsonb(db, rulebook.applied)},
        p_findings => ${jsonb(db, findings)},
        p_created_by => ${actor.label},
        p_summary => ${summary},
        p_details => ${jsonb(db, details)},
        p_max => ${LIMITS.reevaluationsPerRun}::integer
      ) as number`;
    return { ok: true, number: Number(row?.number), changes };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (limitReached(error)) {
      return {
        ok: false,
        message: `A run can be re-evaluated up to ${LIMITS.reevaluationsPerRun} times.`,
      };
    }
    if (runGone(error)) return { ok: false, message: "No such run." };
    throw error;
  }
}

const STALE_MESSAGE =
  "The run was just re-evaluated. Look at the new Evaluation and review again.";

export type ReviewResult = { ok: true } | { ok: false; message: string };

/**
 * A Reviewer settles a flagged Finding of the run's latest Evaluation as
 * Pass or Fail, with a note. Kept with a `finding.reviewed` event.
 */
export async function reviewFinding(
  owner: Owner,
  actor: AuditActor,
  runId: string,
  requirementId: unknown,
  /** The Evaluation the Reviewer was looking at. */
  evaluation: number,
  input: ReviewInput,
): Promise<ReviewResult> {
  if (!isRequirementId(requirementId)) {
    return { ok: false, message: "No such Requirement." };
  }
  const checked = checkReview(input);
  if (!checked.ok) return checked;

  const view = await loadRun(runId, owner);
  if (!view) return { ok: false, message: "No such run." };
  if (view.status !== "completed") {
    return { ok: false, message: "Only a finished run can be reviewed." };
  }
  const latest = view.evaluations.at(-1);
  // A decision stands on the Finding the Reviewer read; if a re-evaluation
  // has replaced it since, they must look again. The database checks the
  // same under the run lock, for a re-evaluation that lands after this load.
  if (!latest || latest.number !== evaluation) {
    return { ok: false, message: STALE_MESSAGE };
  }
  const finding = latest.findings.find(
    (item) => item.requirementId === requirementId,
  );
  if (!finding) {
    return { ok: false, message: "The latest Evaluation has no such Finding." };
  }
  if (!needsReviewer(finding.outcome)) {
    return { ok: false, message: "A passing Finding needs no Reviewer." };
  }
  if (view.reviews.length >= LIMITS.reviewsPerRun) {
    return {
      ok: false,
      message: `A run takes up to ${LIMITS.reviewsPerRun} Reviewer decisions.`,
    };
  }

  const verb = finding.outcome === checked.outcome ? "Confirmed" : "Overrode";
  const db = sql();
  try {
    await db`
      select document_compliance.record_review(
        p_owner => ${owner},
        p_run_id => ${runId}::uuid,
        p_evaluation => ${evaluation}::integer,
        p_requirement_id => ${requirementId},
        p_finding_outcome => ${finding.outcome},
        p_outcome => ${checked.outcome},
        p_note => ${checked.note},
        p_reviewer => ${actor.label},
        p_summary => ${`${verb} "${finding.title}": ${OUTCOME_LABELS[finding.outcome]} → ${OUTCOME_LABELS[checked.outcome]}`},
        p_details => ${jsonb(db, {
          requirementId,
          evaluation: latest.number,
          from: finding.outcome,
          to: checked.outcome,
          note: checked.note,
        })},
        p_max => ${LIMITS.reviewsPerRun}::integer
      )`;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (limitReached(error)) {
      return {
        ok: false,
        message: `A run takes up to ${LIMITS.reviewsPerRun} Reviewer decisions.`,
      };
    }
    if (runGone(error)) return { ok: false, message: "No such run." };
    if (error.message.includes("stale_evaluation")) {
      return { ok: false, message: STALE_MESSAGE };
    }
    throw error;
  }
  return { ok: true };
}
