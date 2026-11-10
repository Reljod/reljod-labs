import type { Scenario } from "./domain/case-file";
import type { JobId } from "./domain/jobs";
import type { ModelSettingsByPurpose, Purpose } from "./domain/model-config";
import type { PipelineId } from "./domain/pipelines";
import type { SourceFormat } from "./domain/run-state";

export type DocView = {
  id: string;
  name: string;
  sourceFormat: SourceFormat;
  pageCount: number;
  /** Signed URL of the first page image, for the Cabinet's thumbnails. */
  thumbUrl: string | null;
};

export type FolderView = {
  slug: string;
  title: string;
  scenario: Scenario;
  summary: string;
  split: "train" | "validation" | "test";
  documents: DocView[];
};

export type MessageView = {
  id: number;
  role: "user" | "specialist";
  text: string;
  documentIds: string[];
  runId: string | null;
  tools: string[];
};

export type RunSummary = {
  id: string;
  pipeline: PipelineId | null;
  jobs: JobId[];
  status: "queued" | "running" | "waiting" | "completed" | "failed";
  recommendation: string | null;
  createdAt: string;
};

export type SpendView = {
  totalUsd: number;
  rows: {
    purpose: Purpose;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
};

export type DeskView = {
  sessionId: string;
  folders: FolderView[];
  uploads: DocView[];
  messages: MessageView[];
  runs: RunSummary[];
  spend: SpendView;
  settings: ModelSettingsByPurpose;
};
