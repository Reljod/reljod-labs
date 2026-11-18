import "server-only";
import type {
  Score,
  StopReason,
  Tamper,
  TrailEventInput,
} from "../domain/contract";
import { manifestEntry } from "../domain/corpus";
import { scoreExamination, tampersOfEdits } from "../domain/score";
import {
  endExaminationIfGoing,
  type ExaminationRow,
  getExamination,
  isOver,
  ownedUpload,
} from "./repository";
import { disposeSandbox } from "./sandbox";
import { type Standing, standingOf } from "./tools";
import { emit } from "./trail";

/** The ground truth of an Examination's Document, when there is one: a Sample's Manifest, a Forgery's Edits. */
async function truthOf(row: ExaminationRow): Promise<Tamper[] | null> {
  if (row.source.kind === "sample")
    return manifestEntry(row.source.sampleId)?.tampers ?? null;
  if (!row.is_forgery) return null;
  const upload = await ownedUpload(row.owner, row.source.uploadId);
  return upload?.forgery ? tampersOfEdits(upload.forgery.edits) : null;
}

export async function scoreOf(
  row: ExaminationRow,
  standing: Standing,
): Promise<Score | null> {
  const tampers = await truthOf(row);
  if (!tampers) return null;
  return scoreExamination({
    tampers,
    findings: standing.findings,
    verdict: standing.verdict.verdict,
  });
}

// End --------------------------------------------------------------------------------

export type EndOutcome =
  | { status: "completed"; summary?: string; note?: string; stoppedBy?: StopReason }
  | { status: "failed"; error: string };

/**
 * Ends an Examination: decides the Findings and the Verdict from its state
 * under its Rulebook, scores it when the truth is known, writes the last
 * events and the row, and stops the Sandbox. An Examination already over
 * (stopped by its Owner, failed elsewhere) keeps its status and gets no
 * second end event.
 */
export async function endExamination(
  examinationId: string,
  outcome: EndOutcome,
): Promise<{ status: "completed" | "failed" | "stopped" }> {
  try {
    const row = await getExamination(examinationId);
    if (!row) return { status: "failed" };
    if (isOver(row.status))
      return {
        status:
          row.status === "completed" || row.status === "stopped"
            ? row.status
            : "failed",
      };
    const standing = standingOf(row, row.state);
    const score =
      outcome.status === "completed" ? await scoreOf(row, standing) : null;
    const events: TrailEventInput[] = [];
    if (outcome.status === "completed" && outcome.summary)
      events.push({ type: "thought", text: outcome.summary });
    if (outcome.status === "completed" && outcome.note)
      events.push({ type: "log", level: "warn", text: outcome.note });
    if (outcome.status === "failed")
      events.push({ type: "log", level: "error", text: outcome.error });
    events.push(
      {
        type: "findings",
        findings: standing.findings,
        verdict: standing.verdict,
        rulebookVersion: row.rulebook_version,
      },
      { type: "gate", gate: standing.gate },
    );
    // What it did is on the Trail before the row says it is over; `end`
    // follows only if this call is the one that ended the row.
    await emit(examinationId, ...events);
    const ended = await endExaminationIfGoing(examinationId, {
      status: outcome.status,
      findings: standing.findings,
      verdict: outcome.status === "completed" ? standing.verdict : null,
      gate: standing.gate,
      score,
      error: outcome.status === "failed" ? outcome.error.slice(0, 500) : null,
      stopped_by:
        outcome.status === "completed" ? (outcome.stoppedBy ?? null) : null,
    });
    if (!ended) {
      const latest = await getExamination(examinationId);
      return {
        status:
          latest?.status === "completed" || latest?.status === "stopped"
            ? latest.status
            : "failed",
      };
    }
    await emit(examinationId, {
      type: "end",
      status: outcome.status,
      gatePassed: standing.gate.passed,
      ...(outcome.status === "completed"
        ? { verdict: standing.verdict.verdict }
        : { error: outcome.error }),
      ...(outcome.status === "completed" && outcome.stoppedBy
        ? { stoppedBy: outcome.stoppedBy }
        : {}),
      ...(score ? { score } : {}),
    });
    return { status: outcome.status };
  } finally {
    await disposeSandbox(examinationId);
  }
}

