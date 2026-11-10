import type { Scenario } from "./domain/case-file";
import type { ChoiceOption } from "./domain/chat-events";
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
  sizeBytes: number;
  /** Seeded Documents: what it is, from its label. Uploads: null until sorted. */
  kind: string | null;
  /** The people and companies this Document is about, for grouping by name. */
  entities: string[];
  /** The Case file it sits in; null for an upload. */
  folder: string | null;
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
  tools: { name: string; ok: boolean; summary?: string }[];
  /** Choices the Specialist offered with this message. */
  choices: { question: string; options: ChoiceOption[] } | null;
};

export type RunSummary = {
  id: string;
  pipeline: PipelineId | null;
  jobs: JobId[];
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "stopped";
  recommendation: string | null;
  createdAt: string;
  /** What the Run's model calls cost, so far or in total. */
  costUsd: number;
  calls: number;
  documentIds: string[];
};

/** One earlier desk this browser can go back to. */
export type DeskSummary = {
  id: string;
  title: string;
  lastActiveAt: string;
  spendUsd: number;
  current: boolean;
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
  desks: DeskSummary[];
  folders: FolderView[];
  uploads: DocView[];
  messages: MessageView[];
  runs: RunSummary[];
  spend: SpendView;
  settings: ModelSettingsByPurpose;
};
