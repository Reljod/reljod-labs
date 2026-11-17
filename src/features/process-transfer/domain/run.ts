import type { Deck, DeckPlan } from "./deck";
import type { ModelCall, ModelChoice } from "./models";
import type { Process, Watch } from "./process";
import type { CheckResult, ReviewFinding, Rule, RuleOverrides } from "./rules";

/*
 * A Run: one Recording going through the pipeline. This file is the contract
 * between the workflow (which writes a Run), the database row (which keeps
 * it) and the screen (which shows it): all three use `RunView`.
 */

/** The pipeline, in order. Design and Check repeat once per Round. */
export const STAGES = [
  {
    id: "watch",
    label: "Watch",
    does: "A model that takes video listens to the call and reads the shared screen, moment by moment.",
    purpose: "watch",
  },
  {
    id: "extract",
    label: "Extract",
    does: "The moments become a Process: steps, roles, systems, decisions, exceptions and open questions.",
    purpose: "write",
  },
  {
    id: "verify",
    label: "Verify",
    does: "Process Rules run, and a second model checks every step against the Recording. Findings go back for one repair.",
    purpose: "review",
  },
  {
    id: "document",
    label: "Document",
    does: "The Process is laid out as a workflow document. No model: the same Process always gives the same document.",
    purpose: null,
  },
  {
    id: "design",
    label: "Design",
    does: "A model plans the slides in words; a layout engine places every element on a grid and gives it an entrance.",
    purpose: "write",
  },
  {
    id: "check",
    label: "Check",
    does: "Layout, content and motion Rules measure the laid-out Deck, and a reviewer model reads it. Failures send it back to Design.",
    purpose: "review",
  },
  {
    id: "approve",
    label: "Approve",
    does: "A Deck with no blocking failure is approved. One that still fails after the last Round is held for a person.",
    purpose: null,
  },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export const STAGE_IDS = STAGES.map((stage) => stage.id) as StageId[];

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type StageState = {
  id: StageId;
  status: StageStatus;
  /** What it found, once done: "9 steps, 2 decisions". */
  summary: string | null;
  ms: number | null;
};

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export function isOver(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

/** One pass of Design and Check over the Deck. */
export type DeckRound = {
  /** 1-based. */
  round: number;
  /** Who produced this Round's plan: the first draft, a model revision, or the fit-by-rule pass. */
  by: "draft" | "revision" | "auto-fit";
  plan: DeckPlan;
  deck: Deck;
  checks: CheckResult[];
  findings: ReviewFinding[];
  /** No blocking Check failed and the reviewer raised nothing major. */
  passed: boolean;
};

export type Approval = {
  status: "approved" | "held";
  /** The Round that was approved, or the last one tried. */
  round: number;
  at: string;
  /** One sentence: why. */
  reason: string;
};

export type RunSource =
  | { kind: "sample"; slug: string }
  | { kind: "upload"; name: string };

export type RunLog = {
  at: number;
  level: "info" | "warn" | "error";
  text: string;
};

/** Everything about one Run that the screen shows. */
export type RunView = {
  id: string;
  title: string;
  status: RunStatus;
  source: RunSource;
  /** Where the browser plays the Recording from; null if it is gone. */
  videoUrl: string | null;
  createdAt: string;
  completedAt: string | null;
  stages: StageState[];
  watch: Watch | null;
  process: Process | null;
  processChecks: CheckResult[];
  /** What the reviewer model found in the Process, before any repair. */
  processFindings: ReviewFinding[];
  rounds: DeckRound[];
  approval: Approval | null;
  calls: ModelCall[];
  costUsd: number;
  /** The Rules and models this Run used, fixed when it started. */
  rules: Rule[];
  rulesVersion: number;
  models: ModelChoice;
  logs: RunLog[];
  error: string | null;
};

/** The parts of a Run a stage may change while it works. */
export type RunPatch = Partial<
  Pick<
    RunView,
    | "title"
    | "status"
    | "stages"
    | "watch"
    | "process"
    | "processChecks"
    | "processFindings"
    | "rounds"
    | "approval"
    | "costUsd"
    | "completedAt"
    | "error"
  >
>;

/** What a Run streams while it works, as newline-delimited JSON. */
export type RunEvent = { at: number } & (
  | { type: "patch"; patch: RunPatch }
  | { type: "call"; call: ModelCall }
  | { type: "log"; level: RunLog["level"]; text: string }
  | { type: "end"; status: Exclude<RunStatus, "queued" | "running"> }
);
export type RunEventInput = RunEvent extends infer E
  ? E extends { at: number }
    ? Omit<E, "at">
    : never
  : never;

/** Folds one event into the Run on screen. */
export function applyEvent(run: RunView, event: RunEvent): RunView {
  switch (event.type) {
    case "patch":
      return { ...run, ...event.patch };
    case "call":
      return run.calls.some((call) => call.id === event.call.id)
        ? run
        : { ...run, calls: [...run.calls, event.call] };
    case "log":
      return {
        ...run,
        logs: [
          ...run.logs,
          { at: event.at, level: event.level, text: event.text },
        ],
      };
    case "end":
      return { ...run, status: event.status };
  }
}

export function freshStages(): StageState[] {
  return STAGE_IDS.map((id) => ({
    id,
    status: "pending",
    summary: null,
    ms: null,
  }));
}

/** The approved Deck, or the last one tried. */
export function finalRound(run: Pick<RunView, "rounds">): DeckRound | null {
  return run.rounds.at(-1) ?? null;
}

/** A Run in a list. */
export type RunSummary = {
  id: string;
  title: string;
  status: RunStatus;
  source: RunSource;
  createdAt: string;
  costUsd: number;
  steps: number | null;
  slides: number | null;
  approval: Approval["status"] | null;
};

// Audit ----------------------------------------------------------------------

export const AUDIT_ACTIONS = {
  "run.started": "Started a Run",
  "run.stopped": "Stopped a Run",
  "run.completed": "Run finished",
  "run.failed": "Run failed",
  "recording.uploaded": "Uploaded a Recording",
  "stage.completed": "Stage finished",
  "model.called": "Called a model",
  "deck.revised": "Deck sent back for revision",
  "deck.approved": "Deck approved",
  "deck.held": "Deck held for a person",
  "deck.redone": "Deck redone under the current Rules",
  "rule.changed": "Changed a Rule",
  "rules.reset": "Reset the Rules",
  "models.changed": "Changed a model",
  "export.downloaded": "Downloaded a file",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** One line of the Audit trail. Written once, never changed. */
export type AuditEvent = {
  id: number;
  at: string;
  /** A person using the demo, or the pipeline acting for them. */
  actor: "person" | "pipeline";
  action: AuditAction;
  runId: string | null;
  /** A sentence: "Changed 'Few points per slide': max 4 to 3". */
  summary: string;
  detail: Record<string, unknown>;
};

// What the screen asks the server for -----------------------------------------

export type Result<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export type Spend = {
  /** USD this Owner's Runs have cost today. */
  todayUsd: number;
  capUsd: number;
  runsLeftThisHour: number;
};

/** Everything the page needs when it opens. */
export type DeskView = {
  runs: RunSummary[];
  rules: Rule[];
  ruleOverrides: RuleOverrides;
  rulesVersion: number;
  models: ModelChoice;
  spend: Spend;
  /** A Run of this Owner that is still going, to reattach to. */
  activeRunId: string | null;
  limits: { uploadBytes: number; uploadSeconds: number };
};

export type StartInput =
  | { kind: "sample"; slug: string }
  | { kind: "upload"; path: string; name: string };

export type UploadTicket = {
  /** Where the file will live in the private bucket; handed back to `startRun`. */
  path: string;
  /** PUT the file here. */
  signedUrl: string;
};

export type ExportKind = "docx" | "pptx";
