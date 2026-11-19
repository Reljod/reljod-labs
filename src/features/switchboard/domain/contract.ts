/**
 * The shapes everything agrees on: a Call, its Events, its Wrap-up. The
 * server writes them, the rows store them, the screen shows them.
 */
import { z } from "zod";
import type { CallState, RuleHit } from "./backoffice";
import type { Language } from "./hearing";
import { LIMITS } from "./limits";
import type { RealtimeUsage } from "./models";
import type { Rulebook } from "./rules";
import type { IssueId, RecordKind } from "./world";

export type Line = "voice" | "text";
export type CallStatus = "live" | "ended" | "cut_off" | "failed";

/** What a Call is about. */
export type Scenario =
  | { kind: "sample"; sampleId: string }
  | { kind: "own"; bookingRef: string; issue: IssueId }
  | { kind: "open" };

export const scenarioSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sample"), sampleId: z.string().max(40) }),
  z.object({
    kind: z.literal("own"),
    bookingRef: z.string().max(20),
    issue: z.enum(["delay", "cancellation", "lost_property", "assistance", "none"]),
  }),
  z.object({ kind: z.literal("open") }),
]);

export type Actor =
  | "caller"
  | "agent"
  | "system"
  | "owner"
  | "client"
  | "supervisor";

/** How one Agent Turn's wait breaks down, in milliseconds. */
export type TurnLatency = {
  /** End of the Caller's Turn (as turn detection or the send button saw it) to the first audio from the model. */
  firstAudioMs: number;
  /** The silence turn detection waits before it calls the Turn over; part of what the Caller feels. */
  detectMs?: number;
  /** Time spent inside tool calls before the answer. */
  toolMs?: number;
};

/** Event payloads, by type. */
export type EventData = {
  "call.started": {
    line: Line;
    origin: "app" | "mcp";
    model: string;
    scenario: Scenario;
    rules: { id: string; version: number; enabled: boolean }[];
    deadlineAt: string;
    consentAudio: boolean;
  };
  "session.opened": { model: string; mintMs: number; connectMs: number };
  "session.error": { message: string };
  /** A compact log of the realtime Session, written once when the Call ends. */
  "session.log": {
    entries: { ms: number; type: string; note?: string }[];
    audioInSeconds: number;
    audioOutSeconds: number;
    dropped: number;
  };
  "turn.caller": {
    text: string;
    language: Language;
    via: "voice" | "text" | "sample" | "mcp";
    /** Milliseconds since the Call started. */
    atMs: number;
  };
  "turn.agent": {
    text: string;
    language: Language;
    atMs: number;
    /** Cut off by a Barge-in. */
    interrupted: boolean;
    /** How much of its audio was played before the cut, when cut. */
    playedMs?: number;
    latency?: TurnLatency;
  };
  barge_in: { atMs: number; playedMs: number };
  "tool.called": { callId: string; name: string; args: unknown };
  "tool.result": {
    callId: string;
    name: string;
    ok: boolean;
    ms: number;
    summary: string;
    output: unknown;
    refusal: RuleHit[];
    records: { kind: RecordKind; ref: string; op: "create" | "update" }[];
  };
  usage: { usage: RealtimeUsage; costUsd: number };
  "model.call": {
    purpose: "turn" | "wrapup" | "supervisor";
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    ms: number;
  };
  "call.ended": { by: "caller" | "agent" | "server" | "client"; reason: string; seconds: number };
  "call.cut_off": { reason: string; seconds: number };
  "audio.saved": { bytes: number };
  "wrapup.started": Record<string, never>;
  "wrapup.step": { step: string; note: string };
  "wrapup.done": { costUsd: number };
  "wrapup.failed": { error: string };
  "code.run": { purpose: "wrapup" | "supervisor"; code: string };
  "code.result": { exitCode: number; stdout: string; stderr: string; ms: number };
  "confirmation.sent": { ref: string; to: string };
  "callback.waiting": { ref: string; dueAt: string };
  "callback.due": { ref: string; early: boolean };
  "rule.saved": { ruleId: string; version: number; enabled: boolean; note: string | null };
  "world.reset": Record<string, never>;
  "scenario.set": { bookingRef: string; issue: string };
  "mcp.token": { expiresAt: string };
  "supervisor.asked": { question: string };
  "supervisor.answered": { text: string; steps: number; costUsd: number };
};

export type EventType = keyof EventData;

export type CallEvent<T extends EventType = EventType> = {
  [K in T]: {
    id: number;
    callId: string | null;
    actor: Actor;
    type: K;
    data: EventData[K];
    at: string;
  };
}[T];

/** What the browser may report about a voice Call: what it heard and measured. */
const latencySchema = z.object({
  firstAudioMs: z.number().min(0).max(120_000),
  detectMs: z.number().min(0).max(10_000).optional(),
  toolMs: z.number().min(0).max(120_000).optional(),
});

const transcriptText = z.string().max(LIMITS.transcriptChars);
const ms = z.number().min(0).max(3_600_000);
const tokens = z.number().min(0).max(10_000_000).optional();

export const reportedEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn.caller"),
    text: transcriptText,
    via: z.enum(["voice", "text", "sample"]),
    atMs: ms,
  }),
  z.object({
    type: z.literal("turn.agent"),
    text: transcriptText,
    atMs: ms,
    interrupted: z.boolean(),
    playedMs: ms.optional(),
    latency: latencySchema.optional(),
  }),
  z.object({ type: z.literal("barge_in"), atMs: ms, playedMs: ms }),
  z.object({
    type: z.literal("usage"),
    usage: z.object({
      inputTokens: tokens,
      outputTokens: tokens,
      cachedInputTokens: tokens,
      inputTextTokens: tokens,
      inputAudioTokens: tokens,
      outputTextTokens: tokens,
      outputAudioTokens: tokens,
      cachedInputTextTokens: tokens,
      cachedInputAudioTokens: tokens,
    }),
  }),
  z.object({
    type: z.literal("session.opened"),
    mintMs: ms,
    connectMs: ms,
  }),
  z.object({ type: z.literal("session.error"), message: z.string().max(300) }),
  z.object({
    type: z.literal("session.log"),
    entries: z
      .array(
        z.object({
          ms,
          type: z.string().max(60),
          note: z.string().max(160).optional(),
        }),
      )
      .max(400),
    audioInSeconds: z.number().min(0).max(3600),
    audioOutSeconds: z.number().min(0).max(3600),
    dropped: z.number().int().min(0).max(1_000_000),
  }),
]);
export type ReportedEvent = z.infer<typeof reportedEventSchema>;

// Wrap-up ---------------------------------------------------------------------------------

export type Verdict = "pass" | "fail" | "na";

export type ScoreItem = {
  id: string;
  /** The Rule it scores, when it scores one. */
  rule: { id: string; version: number } | null;
  title: string;
  verdict: Verdict;
  detail: string;
};

export type Scorecard = {
  items: ScoreItem[];
  passed: number;
  failed: number;
  /** Refusals in the Call, by Rule. */
  held: { ruleId: string; version: number; title: string; times: number }[];
};

export type CallStats = {
  seconds: number;
  callerTurns: number;
  agentTurns: number;
  bargeIns: number;
  toolCalls: number;
  refusals: number;
  languages: Language[];
  /** Time to first audio over the Call's Agent Turns. */
  firstAudio: { turns: number; medianMs: number | null; p95Ms: number | null; worstMs: number | null };
};

export type FollowUp =
  | { kind: "confirmation"; status: "sent" | "none"; ref: string | null; detail: string }
  | {
      kind: "callback";
      status: "none" | "waiting" | "due";
      ref: string | null;
      dueAt: string | null;
      detail: string;
    };

export type Wrapup = {
  summary: string;
  /** What was done, each tied to a Record where there is one. */
  actions: { what: string; ref: string | null }[];
  /** What the Agent told the Caller would happen. */
  promises: string[];
  /** The Caller's mood, Turn by Turn: -2 furious to 2 delighted. */
  sentiment: { turn: number; score: number; label: string }[];
  scorecard: Scorecard;
  stats: CallStats;
  followUps: FollowUp[];
  /** Numbers the Agent worked out in the Sandbox, when it could. */
  analysis: { code: string; output: string } | null;
  model: string;
  costUsd: number;
};

// Views -----------------------------------------------------------------------------------

export type CallView = {
  id: string;
  line: Line;
  origin: "app" | "mcp";
  status: CallStatus;
  endReason: string | null;
  model: string;
  scenario: Scenario;
  rulebook: Rulebook;
  state: CallState;
  consentAudio: boolean;
  hasAudio: boolean;
  usage: RealtimeUsage;
  costUsd: number;
  wrapup: Wrapup | null;
  wrapupStatus: "none" | "running" | "done" | "failed";
  deadlineAt: string;
  startedAt: string;
  endedAt: string | null;
};

/** A Call in a list: enough for a row. */
export type CallSummary = Pick<
  CallView,
  | "id"
  | "line"
  | "origin"
  | "status"
  | "model"
  | "scenario"
  | "costUsd"
  | "wrapupStatus"
  | "startedAt"
  | "endedAt"
> & {
  headline: string | null;
  refusals: number;
  score: { passed: number; failed: number } | null;
};

/** One line the text Line streams while the Agent works on a Turn (NDJSON). */
export type TurnStreamPart =
  | { kind: "event"; event: CallEvent }
  | { kind: "delta"; text: string }
  | { kind: "call"; call: CallView }
  | { kind: "error"; message: string }
  | { kind: "done" };

/** One line the Supervisor streams (NDJSON). */
export type SupervisorStreamPart =
  | { kind: "delta"; text: string }
  | { kind: "tool"; name: string; note: string }
  | { kind: "code"; code: string }
  | { kind: "code_result"; exitCode: number; stdout: string; stderr: string }
  | { kind: "error"; message: string }
  | { kind: "done"; costUsd: number; steps: number };

export const seconds = (from: string, to: string | null, now = Date.now()) =>
  Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000));
