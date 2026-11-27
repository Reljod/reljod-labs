/**
 * The stored shapes of a Run, an Upload and an event, and what is worked out
 * from a row. Pure, so the services and their tests use them without the
 * database.
 */
import type { Owner } from "@/features/access/domain/owner";
import {
  DEFAULT_MODELS,
  type DocumentSource,
  type ExtractedName,
  type ModelChoice,
  modelChoiceSchema,
  type Rulebook,
  type RunEvent,
  type RunStatus,
  type RunSummary,
  type Score,
  type StopReason,
} from "../domain/contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

export type RunRow = {
  id: string;
  owner: Owner;
  title: string;
  pages: number;
  source: DocumentSource;
  status: RunStatus;
  models: ModelChoice;
  rulebook_version: number;
  rulebook: Rulebook;
  workflow_run_id: string | null;
  cost_usd: string | number;
  names: ExtractedName[];
  score: Score | null;
  error: string | null;
  /** The Done gate's verdict at the end; null when ended outside the workflow. */
  gate_passed: boolean | null;
  /** Why the harness wound a completed Run up early, if it did. */
  stopped_by: StopReason | null;
  visitor_hash: string;
  started_at: string;
  ended_at: string | null;
};

export type UploadRow = {
  id: string;
  owner: Owner;
  title: string;
  pages: number;
  storage_path: string;
  created_at: string;
};

/** An Audit trail event with its seq: the cursor a stream resumes from. */
export type StoredEvent = RunEvent & { seq: number };

export function isOver(status: RunStatus) {
  return status === "completed" || status === "failed" || status === "stopped";
}

export function toSummary(row: RunRow): RunSummary {
  const models = modelChoiceSchema.safeParse(row.models);
  return {
    id: row.id,
    title: row.title,
    pages: row.pages,
    source: row.source,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    models: models.success ? models.data : DEFAULT_MODELS,
    rulebookVersion: row.rulebook_version,
    costUsd: Number(row.cost_usd) || 0,
    names: Array.isArray(row.names) ? row.names.length : 0,
    score: row.score ?? null,
    gatePassed: row.gate_passed ?? null,
    stoppedBy: row.stopped_by ?? null,
  };
}
