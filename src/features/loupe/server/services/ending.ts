import type {
  ExaminationStatus,
  Score,
  Tamper,
  TrailEventInput,
} from "../../domain/contract";
import { manifestEntry } from "../../domain/corpus";
import { STALE_EXAMINATION_MS } from "../../domain/limits";
import { scoreExamination, tampersOfEdits } from "../../domain/score";
import {
  type ExaminationRow,
  isOver,
  type Standing,
  standingOf,
} from "../examination";
import type { EndOutcome, LoupePorts } from "../ports";
import type { Shared } from "./shared";

type Ended = { status: "completed" | "failed" | "stopped" };

/** What `closeIfStale` needs to know of an Examination: its row or its pulse. */
export type StaleCheck = {
  id: string;
  status: ExaminationStatus;
  started_at: string;
  driver: ExaminationRow["state"]["driver"];
  pageCount: number;
};

/** How an Examination ends, for the workflow, a client's `finish` and the reads that find one lost. */
export type Ending = {
  /** Its Score when the truth is known: a Sample's Manifest, a Forgery's Edits. */
  scoreOf(row: ExaminationRow, standing: Standing): Promise<Score | null>;
  /**
   * Ends an Examination: decides the Findings and the Verdict from its state
   * under its Rulebook, scores it when the truth is known, writes the last
   * events and the row, and stops the Sandbox. An Examination already over
   * (stopped by its Owner, failed elsewhere) keeps its status and gets no
   * second end event. A completed one with no summary takes the one its
   * `finish` kept.
   */
  end(examinationId: string, outcome: EndOutcome): Promise<Ended>;
  /**
   * Closes an Examination whose workflow (or whose client) is long gone, so
   * it stops counting as active. True when this call closed it.
   */
  closeIfStale(target: StaleCheck): Promise<boolean>;
};

const settled = (status: ExaminationStatus | undefined): Ended["status"] =>
  status === "completed" || status === "stopped" ? status : "failed";

export function createEnding(
  ports: Pick<LoupePorts, "examinations" | "uploads" | "sandbox" | "now"> & {
    shared: Shared;
  },
): Ending {
  const { examinations, uploads, sandbox, shared } = ports;

  async function truthOf(row: ExaminationRow): Promise<Tamper[] | null> {
    if (row.source.kind === "sample")
      return manifestEntry(row.source.sampleId)?.tampers ?? null;
    if (!row.is_forgery) return null;
    const upload = await uploads.owned(row.owner, row.source.uploadId);
    return upload?.forgery ? tampersOfEdits(upload.forgery.edits) : null;
  }

  async function scoreOf(row: ExaminationRow, standing: Standing) {
    const tampers = await truthOf(row);
    if (!tampers) return null;
    return scoreExamination({
      tampers,
      findings: standing.findings,
      verdict: standing.verdict.verdict,
    });
  }

  async function end(examinationId: string, asked: EndOutcome): Promise<Ended> {
    try {
      const row = await examinations.get(examinationId);
      if (!row) return { status: "failed" };
      if (isOver(row.status)) return { status: settled(row.status) };
      const outcome: EndOutcome =
        asked.status === "completed" && !asked.summary
          ? { ...asked, summary: row.state.finished?.summary }
          : asked;
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
      if (outcome.status === "completed")
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
      await shared.emit(examinationId, ...events);
      const ended = await examinations.endIfGoing(examinationId, {
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
        const latest = await examinations.pulse(examinationId);
        return { status: settled(latest?.status) };
      }
      await shared.emit(examinationId, {
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
      await sandbox.dispose(examinationId);
    }
  }

  return {
    scoreOf,
    end,
    async closeIfStale(target) {
      if (isOver(target.status)) return false;
      if (ports.now() - Date.parse(target.started_at) < STALE_EXAMINATION_MS)
        return false;
      // A client's own Examination that it never finished ends with what was measured.
      await end(
        target.id,
        target.driver === "client" && target.pageCount > 0
          ? {
              status: "completed",
              stoppedBy: "idle",
              note: "The client stopped calling tools before the Done gate passed.",
            }
          : {
              status: "failed",
              error: "The Examination lost its workflow and was closed.",
            },
      );
      return true;
    },
  };
}
