import type { ModelCall, ModelChoice } from "../domain/models";
import type { Process, Watch } from "../domain/process";
import type { CheckResult, ReviewFinding, Rule } from "../domain/rules";
import type {
  Approval,
  DeckRound,
  RunLog,
  RunSource,
  RunStatus,
  RunView,
  StageState,
} from "../domain/run";

/*
 * The shape of a `process_transfer.runs` row as the repository reads it, and
 * how it becomes the `RunView` the screen shows. Plain types and a mapping,
 * so the services and their tests use them without a database.
 */

export type RunRow = {
  id: string;
  owner: string;
  visitor_hash: string;
  source_kind: "sample" | "upload";
  sample_slug: string | null;
  recording_path: string | null;
  recording_name: string | null;
  recording_type: string | null;
  status: RunStatus;
  title: string;
  workflow_run_id: string | null;
  stages: StageState[];
  watch: Watch | null;
  process: Process | null;
  process_checks: CheckResult[];
  process_findings: ReviewFinding[];
  rounds: DeckRound[];
  approval: Approval | null;
  /** The grounding Check as Verify computed it; kept for every later Redo. */
  grounding: CheckResult | null;
  rules: Rule[];
  rules_version: number;
  models: ModelChoice;
  logs: RunLog[];
  cost_usd: string | number;
  redos: number;
  error: string | null;
  created_at: Date;
  started_at: Date;
  completed_at: Date | null;
};

/** What the one-active-Run gate needs of a Run still going: never its jsonb columns. */
export type ActiveRun = Pick<RunRow, "id" | "title" | "started_at">;

export type SettingsRow = {
  owner: string;
  rule_overrides: unknown;
  models: unknown;
  version: number;
};

export function sourceOf(
  row: Pick<RunRow, "source_kind" | "sample_slug" | "recording_name">,
): RunSource {
  return row.source_kind === "sample"
    ? { kind: "sample", slug: row.sample_slug ?? "" }
    : { kind: "upload", name: row.recording_name ?? "Recording" };
}

export function toRunView(
  row: RunRow,
  calls: ModelCall[],
  videoUrl: string | null,
): RunView {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    source: sourceOf(row),
    videoUrl,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    stages: row.stages,
    watch: row.watch,
    process: row.process,
    processChecks: row.process_checks,
    processFindings: row.process_findings,
    rounds: row.rounds,
    approval: row.approval,
    calls,
    costUsd: Number(row.cost_usd),
    rules: row.rules,
    rulesVersion: row.rules_version,
    models: row.models,
    logs: row.logs,
    error: row.error,
  };
}
