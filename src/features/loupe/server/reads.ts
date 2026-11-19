import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { CorpusResponse } from "../domain/api";
import type { ExaminationDetail } from "../domain/contract";
import { MANIFEST, RECORDED } from "../domain/corpus";
import { fallbackPages } from "./document";
import { closeIfStale } from "./examinations";
import {
  allEvents,
  listExaminations,
  listRulebooks,
  ownedExamination,
  toSummary,
} from "./repository";
import { standingOf } from "./tools";

/**
 * An Examination with its Trail, for the page and for `get_examination`.
 * Page images and Evidence layers are refs: one starting with "/" is a
 * static Sample file; anything else is an asset key of this Examination,
 * served by the asset route to its Owner.
 */
export async function examinationDetail(
  owner: Owner,
  examinationId: string,
): Promise<ExaminationDetail | null> {
  const found = await ownedExamination(owner, examinationId);
  if (!found) return null;
  const [row, events] = await Promise.all([
    closeIfStale(found),
    allEvents(found.id),
  ]);
  // While it runs, the row's Findings trail the state by a tool call at most;
  // decide them from the state so the page never shows a stale Verdict.
  const live = row.status === "running" && row.pages.length > 0;
  const standing = live ? standingOf(row, row.state) : null;
  return {
    ...toSummary(row),
    pages: row.pages.length ? row.pages : fallbackPages(row),
    measurements: row.state.measurements,
    hypotheses: row.state.hypotheses,
    findingList: standing?.findings ?? row.findings,
    verdictResult: standing?.verdict ?? row.verdict,
    gate: standing?.gate ?? row.gate,
    events,
  };
}

/** What the page shows first: the Owner's Examinations and Rulebook versions. */
export async function initialView(owner: Owner) {
  const [examinations, rulebooks] = await Promise.all([
    listExaminations(owner),
    listRulebooks(owner),
  ]);
  return { examinations, rulebooks };
}

let corpus: CorpusResponse | undefined;

/** The Manifest and every recorded Sweep: seed data, the same for everyone. */
export function corpusResponse(): CorpusResponse {
  corpus ??= { entries: MANIFEST, sweeps: [...RECORDED.values()] };
  return corpus;
}
