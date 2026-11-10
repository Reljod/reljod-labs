import { z } from "zod";
import type { DocumentKind } from "./document-kinds";
import type { JobId } from "./jobs";
import type { PipelineId } from "./pipelines";
import type {
  Arrears,
  Check,
  Decision,
  Evidence,
  FieldValue,
  Hit,
  Ownership,
  Risk,
} from "./run-state";

/** What a Run streams to whoever is watching: the desk, the terminal, an MCP client. */
export type RunEvent = { at: number } & (
  | {
      type: "plan";
      pipeline: PipelineId | null;
      jobs: JobId[];
      /** True when the pipeline was worked out from the sorted Documents. */
      inferred: boolean;
    }
  | {
      type: "job";
      index: number;
      job: JobId;
      state: "start" | "done" | "skipped" | "waiting" | "error";
      summary?: string;
      ms?: number;
    }
  | {
      type: "document";
      documentId: string;
      name: string;
      kind: DocumentKind | null;
      gist: string;
    }
  | {
      type: "field";
      documentId: string;
      name: string;
      value: FieldValue;
      evidence?: Evidence;
    }
  | { type: "check"; check: Check }
  | {
      type: "question";
      questionId: string;
      job: JobId;
      prompt: string;
      kinds: DocumentKind[];
      /** Choices offered as buttons, such as which pipeline to run. */
      options: { value: string; label: string }[];
      /** Documents on file that look like what is wanted, to offer by name. */
      suggestions?: { id: string; name: string }[];
    }
  | { type: "answer"; questionId: string; summary: string }
  | { type: "hits"; hits: Hit[] }
  | { type: "ownership"; ownership: Ownership }
  | { type: "arrears"; arrears: Arrears }
  | { type: "risk"; risk: Risk }
  | { type: "decision"; decision: Decision }
  | {
      type: "cost";
      purpose: string;
      model: string;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      ms: number;
    }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | { type: "end"; status: "completed" | "failed" | "stopped"; error?: string }
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type RunEventInput = DistributiveOmit<RunEvent, "at">;

/** How a Question is answered: Documents, a choice, free text, or "go on without it". */
export const answerSchema = z.object({
  documentIds: z.array(z.string()).max(12).optional(),
  choice: z.string().max(100).optional(),
  text: z.string().max(500).optional(),
  skip: z.boolean().optional(),
});

export type Answer = z.infer<typeof answerSchema>;
