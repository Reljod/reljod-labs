import type { DocumentKind } from "../domain/document-kinds";
import type { JobId } from "../domain/jobs";
import type { PipelineId } from "../domain/pipelines";
import type { RunEvent } from "../domain/run-events";
import type {
  Arrears,
  Check,
  Decision,
  Evidence,
  FieldValue,
  Hit,
  Ownership,
  Risk,
} from "../domain/run-state";

export type JobState =
  | "pending"
  | "running"
  | "waiting"
  | "done"
  | "skipped"
  | "error";

export type RunDocView = {
  id: string;
  name: string;
  kind: DocumentKind | null;
  gist: string;
  fields: { name: string; value: FieldValue }[];
  evidence: Record<string, Evidence>;
};

export type OpenQuestion = {
  questionId: string;
  job: JobId;
  prompt: string;
  kinds: DocumentKind[];
  options: { value: string; label: string }[];
};

export type LogLine = {
  at: number;
  level: "info" | "warn" | "error";
  text: string;
};

export type RunView = {
  pipeline: PipelineId | null;
  inferred: boolean;
  jobs: { job: JobId; state: JobState; summary?: string }[];
  /** The job being worked, or waiting on the person. */
  current: number;
  documents: RunDocView[];
  /** The document the read job touched last, for the reading view. */
  reading: string | null;
  checks: Check[];
  hits: Hit[] | null;
  ownership: Ownership | null;
  arrears: Arrears | null;
  risk: Risk | null;
  decision: Decision | null;
  question: OpenQuestion | null;
  answered: { questionId: string; summary: string }[];
  logs: LogLine[];
  costUsd: number;
  calls: number;
  status: "running" | "waiting" | "completed" | "failed";
  error: string | null;
  /** How many events have been applied, to resume a stream from. */
  seen: number;
};

export const emptyRun: RunView = {
  pipeline: null,
  inferred: false,
  jobs: [],
  current: 0,
  documents: [],
  reading: null,
  checks: [],
  hits: null,
  ownership: null,
  arrears: null,
  risk: null,
  decision: null,
  question: null,
  answered: [],
  logs: [],
  costUsd: 0,
  calls: 0,
  status: "running",
  error: null,
  seen: 0,
};

function upsertDocument(
  documents: RunDocView[],
  id: string,
  patch: (document: RunDocView) => RunDocView,
) {
  const existing = documents.find((document) => document.id === id);
  const base: RunDocView = existing ?? {
    id,
    name: "",
    kind: null,
    gist: "",
    fields: [],
    evidence: {},
  };
  const next = patch(base);
  return existing
    ? documents.map((document) => (document.id === id ? next : document))
    : [...documents, next];
}

/** Folds one streamed event into the view. Pure, so replays land in the same place. */
export function reduceRun(view: RunView, event: RunEvent): RunView {
  const next = { ...view, seen: view.seen + 1 };
  switch (event.type) {
    case "plan": {
      const previous = new Map(
        view.jobs.map((item, index) => [`${index}:${item.job}`, item]),
      );
      return {
        ...next,
        pipeline: event.pipeline,
        inferred: event.inferred,
        jobs: event.jobs.map(
          (job, index) =>
            previous.get(`${index}:${job}`) ?? {
              job,
              state: "pending" as const,
            },
        ),
      };
    }
    case "job": {
      const jobs = [...view.jobs];
      while (jobs.length <= event.index)
        jobs.push({ job: event.job, state: "pending" });
      const state: JobState =
        event.state === "start"
          ? "running"
          : event.state === "error"
            ? "error"
            : event.state;
      jobs[event.index] = {
        job: event.job,
        state,
        summary: event.summary ?? jobs[event.index]?.summary,
      };
      return {
        ...next,
        jobs,
        current: event.index,
        status:
          event.state === "waiting"
            ? "waiting"
            : view.status === "waiting"
              ? "running"
              : view.status,
      };
    }
    case "document":
      return {
        ...next,
        documents: upsertDocument(
          view.documents,
          event.documentId,
          (document) => ({
            ...document,
            name: event.name,
            kind: event.kind,
            gist: event.gist,
          }),
        ),
      };
    case "field":
      return {
        ...next,
        reading: event.documentId,
        documents: upsertDocument(
          view.documents,
          event.documentId,
          (document) => ({
            ...document,
            fields: document.fields.some((field) => field.name === event.name)
              ? document.fields.map((field) =>
                  field.name === event.name
                    ? { name: event.name, value: event.value }
                    : field,
                )
              : [...document.fields, { name: event.name, value: event.value }],
            evidence: event.evidence
              ? { ...document.evidence, [event.name]: event.evidence }
              : document.evidence,
          }),
        ),
      };
    case "check":
      return {
        ...next,
        checks: [
          ...view.checks.filter((check) => check.id !== event.check.id),
          event.check,
        ],
      };
    case "question":
      return {
        ...next,
        status: "waiting",
        question: {
          questionId: event.questionId,
          job: event.job,
          prompt: event.prompt,
          kinds: event.kinds,
          options: event.options,
        },
      };
    case "answer":
      return {
        ...next,
        status: "running",
        question:
          view.question?.questionId === event.questionId ? null : view.question,
        answered: [
          ...view.answered,
          { questionId: event.questionId, summary: event.summary },
        ],
      };
    case "hits":
      return { ...next, hits: event.hits };
    case "ownership":
      return { ...next, ownership: event.ownership };
    case "arrears":
      return { ...next, arrears: event.arrears };
    case "risk":
      return { ...next, risk: event.risk };
    case "decision":
      return { ...next, decision: event.decision };
    case "cost":
      return {
        ...next,
        costUsd: view.costUsd + event.costUsd,
        calls: view.calls + 1,
      };
    case "log":
      return {
        ...next,
        logs: [
          ...view.logs,
          { at: event.at, level: event.level, text: event.text },
        ].slice(-400),
      };
    case "end":
      return {
        ...next,
        status: event.status,
        error: event.error ?? null,
        question: null,
        jobs: view.jobs.map((item) =>
          item.state === "running" || item.state === "waiting"
            ? { ...item, state: event.status === "failed" ? "error" : "done" }
            : item,
        ),
      };
    default:
      return next;
  }
}

/** What the stage should show right now: the newest, most relevant thing. */
export type Focus =
  | { kind: "plan" }
  | { kind: "sort" }
  | { kind: "read"; documentId: string }
  | { kind: "checks"; job: JobId }
  | { kind: "hits" }
  | { kind: "ownership" }
  | { kind: "arrears" }
  | { kind: "question" }
  | { kind: "decision" };

export function focusOf(view: RunView): Focus {
  if (view.decision) return { kind: "decision" };
  const job = view.jobs[view.current]?.job;
  if (view.question && view.jobs.length === 0) return { kind: "question" };
  switch (job) {
    case undefined:
      return { kind: "plan" };
    case "sort":
      return { kind: "sort" };
    case "read":
      return view.reading
        ? { kind: "read", documentId: view.reading }
        : { kind: "sort" };
    case "screen":
    case "adjudicate":
      return view.hits && view.hits.length > 0
        ? { kind: "hits" }
        : { kind: "checks", job };
    case "map_ownership":
      return view.ownership ? { kind: "ownership" } : { kind: "checks", job };
    case "reconcile":
      return view.arrears ? { kind: "arrears" } : { kind: "checks", job };
    default:
      return { kind: "checks", job };
  }
}
