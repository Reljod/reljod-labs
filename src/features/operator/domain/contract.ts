import { z } from "zod";
import type { Change, ScreenCode } from "../legacy/types";
import { type ScreenAction, screenActionSchema } from "./actions";
import type { Finding, Verdict } from "./checks";
import type { ActionKind, Rulebook, RuleId } from "./rules";

/**
 * The contract between the workflow, the database row and the screen: a Run
 * is its summary plus its events (the Trail), append-only and ordered by
 * `seq`. Words: ../GLOSSARY.md.
 */

// Who drives, and with what ---------------------------------------------------------------

/**
 * Who is at the keyboard: the Operator (the in-app agent), an outside MCP
 * client driving the same Screen through the same tools, or the visitor by
 * hand ("take the keyboard", which runs HARBOURMASTER in their own browser).
 */
export const DRIVERS = ["operator", "client", "hand"] as const;
export type Driver = (typeof DRIVERS)[number];

/** Vision models on the AI Gateway the Operator may run on. USD per million tokens, list price. */
export const MODELS = {
  "anthropic/claude-sonnet-5.5": {
    label: "Claude Sonnet 5.5",
    note: "Reads the Screen reliably and plans several fields ahead. The default.",
    input: 2,
    output: 10,
    cachedInput: 0.1,
  },
  "anthropic/claude-haiku-5.5": {
    label: "Claude Haiku 5.5",
    note: "About twenty times cheaper. Slower to recover when a trap bites.",
    input: 0.1,
    output: 0.5,
    cachedInput: 0.01,
  },
} as const;
export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as [ModelId, ...ModelId[]];
export const DEFAULT_MODEL: ModelId = "anthropic/claude-sonnet-5.5";
export const modelSchema = z.enum(MODEL_IDS);

/** List-price cost of one call, when the gateway does not report it. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
) {
  const price = MODELS[model as ModelId] ?? MODELS[DEFAULT_MODEL];
  const fresh = Math.max(0, inputTokens - cachedInputTokens);
  return (
    (fresh * price.input +
      cachedInputTokens * price.cachedInput +
      outputTokens * price.output) /
    1_000_000
  );
}

export type RunStatus =
  | "queued"
  | "running"
  /** Waiting for a person to approve or refuse a guarded Action. */
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export const isOver = (status: RunStatus) =>
  status === "completed" || status === "failed" || status === "stopped";

/** Why a Run ended. `finish`: the driver said it was done. The rest are the harness's caps. */
export type StopReason =
  | "finish"
  | "turns"
  | "actions"
  | "cost"
  | "time"
  | "idle";

/** What a Run is asked to do: a sample Task by id, or the visitor's own words. */
export type TaskRef =
  | { kind: "sample"; taskId: string }
  | { kind: "own"; brief: string };

export const taskRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sample"), taskId: z.string().min(1).max(60) }),
  z.object({ kind: z.literal("own"), brief: z.string().min(1).max(4000) }),
]);

// Events: the Trail ---------------------------------------------------------------------

/** A pixel on the Screen. */
export type Point = { x: number; y: number };

/** A guarded Action the harness stopped before HARBOURMASTER took it. */
export type PendingApproval = {
  approvalId: string;
  actionKind: ActionKind;
  /** The change in plain words. */
  label: string;
  change: Change;
  screen: ScreenCode;
  /** The key that would have committed it, as a label: `key Enter`. */
  key: string;
  /** Frame that shows the Screen at the moment of the pause. */
  frame: number;
  /** Epoch ms after which the harness refuses it on its own. */
  expiresAt: number;
};

export type RunEventInput =
  | {
      type: "start";
      driver: Driver;
      task: { id: string | null; title: string; brief: string };
      manifest: { name: string; rows: number } | null;
      model: ModelId | null;
      rulebookVersion: number;
    }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  /** What the Operator said before acting: its one-line intent, or more. */
  | { type: "thought"; turn: number; text: string }
  /** One model call. */
  | {
      type: "cost";
      turn: number;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      costUsd: number;
      ms: number;
    }
  /**
   * The Screen after one Action (or at the start, when `action` is null).
   * The picture is `frames/<n>.png` of the Run.
   */
  | {
      type: "frame";
      n: number;
      turn: number;
      action: ScreenAction | null;
      /** `type "MRDU4821130"`, `key F10`, or `sign-on screen` for the first. */
      label: string;
      intent: string;
      screen: ScreenCode;
      /** Where the mouse pointer is after the Action. */
      pointer: Point | null;
      /** Where the text cursor is. */
      caret: Point | null;
      /** Records the Action committed. */
      changes: Change[];
      /** HARBOURMASTER's message line after the Action, if any. */
      message: string;
      ms: number;
    }
  /** A Rule fired before a key reached HARBOURMASTER. */
  | {
      type: "rule";
      ruleId: RuleId;
      outcome: "refused" | "paused";
      reason: string;
      /** The Action it stopped, as a label. */
      label: string;
      screen: ScreenCode;
      frame: number;
    }
  | { type: "pause"; pending: PendingApproval }
  | {
      type: "decision";
      approvalId: string;
      decision: "approved" | "refused" | "expired";
      note?: string;
    }
  | { type: "skill"; id: string; title: string }
  | {
      type: "code";
      callId: string;
      code: string;
      /** -1 while it runs. */
      exitCode: number;
      stdout: string;
      stderr: string;
      ms: number;
    }
  /** The Operator's own plan. */
  | { type: "plan"; items: { text: string; done: boolean }[] }
  /** Which of the Task's Expectations the Books already meet (code, after every commit). */
  | { type: "progress"; met: boolean[] }
  | { type: "findings"; verdict: Verdict; findings: Finding[] }
  | {
      type: "end";
      status: "completed" | "failed" | "stopped";
      stoppedBy?: StopReason;
      error?: string;
      summary?: string;
    };

export type RunEvent = RunEventInput & { seq: number; at: number };
export type FrameEvent = Extract<RunEvent, { type: "frame" }>;

/** What a Run cost and took, kept on its row. */
export type RunMetrics = {
  turns: number;
  actions: number;
  frames: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Records committed. */
  records: number;
  /** Times a Rule refused an Action. */
  refusals: number;
  /** Times the Run paused for a person. */
  pauses: number;
  /** Times HARBOURMASTER answered with an error message. */
  errors: number;
  codeRuns: number;
  /** Wall time, ms. */
  ms: number;
};

export const EMPTY_METRICS: RunMetrics = {
  turns: 0,
  actions: 0,
  frames: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  records: 0,
  refusals: 0,
  pauses: 0,
  errors: 0,
  codeRuns: 0,
  ms: 0,
};

export type RunSummary = {
  id: string;
  driver: Driver;
  /** The sample Task's id, or null for an own Task. */
  taskId: string | null;
  title: string;
  brief: string;
  manifestName: string | null;
  model: ModelId | null;
  status: RunStatus;
  stoppedBy: StopReason | null;
  verdict: Verdict | null;
  error: string | null;
  costUsd: number;
  metrics: RunMetrics;
  rulebookVersion: number;
  startedAt: string;
  endedAt: string | null;
  /** Set while the Run is paused. */
  pending: PendingApproval | null;
  /** A recorded Run shipped with the site: its frames are static files. */
  replay?: boolean;
};

export type RunDetail = RunSummary & {
  events: RunEvent[];
  findings: Finding[];
  /** The Task's Expectations as labels, for the checklist; empty for an own Task. */
  expected: string[];
  rulebook: Rulebook;
};

export type RulebookVersion = {
  /** 0 is the Default, which is never stored. */
  version: number;
  rulebook: Rulebook;
  note: string | null;
  createdAt: string | null;
};

export type ManifestSummary = {
  id: string;
  name: string;
  rows: number;
  vessel: string | null;
  voyage: string | null;
  problems: string[];
};

/** One input of a "take the keyboard" attempt: what was pressed and when (ms from the start). */
export const handInputSchema = z.object({
  at: z.number().int().min(0).max(3_600_000),
  action: screenActionSchema,
});
export type HandInput = z.infer<typeof handInputSchema>;

/** The card of a sample Task, without its Script or Fixture. */
export type TaskCard = {
  id: string;
  title: string;
  summary: string;
  brief: string;
  traps: string[];
  needsApproval: boolean;
  manifest: { name: string; href: string; rows: number } | null;
  expected: string[];
};
