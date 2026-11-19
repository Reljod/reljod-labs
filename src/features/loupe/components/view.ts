/**
 * What the page shows of an Examination, folded from its Trail. Pure: the
 * same events always give the same view, whether they came with the first
 * read or down the stream, in whatever chunks. Events are deduped by seq.
 */
import type {
  Box,
  CheckId,
  DoneGate,
  Driver,
  ExaminationStatus,
  Finding,
  Hypothesis,
  Measurement,
  PageInfo,
  Score,
  SkillId,
  StopReason,
  StoredEvent,
  ToolId,
  VerdictResult,
} from "../domain/contract";

export type CodeRun = {
  callId: string;
  check: CheckId | null;
  code: string;
  stdout: string;
  stderr: string;
  /** -1 while it runs. */
  exitCode: number;
  ms: number;
};

export type ToolRun = {
  callId: string;
  tool: ToolId;
  summary: string;
  input: unknown;
  state: "start" | "done" | "error";
  output: string;
  ms: number;
};

/** One line of the Examiner's feed, in order. */
export type FeedItem =
  | { kind: "thought"; seq: number; at: number; text: string }
  | { kind: "tool"; seq: number; at: number; callId: string }
  | {
      kind: "sweep";
      seq: number;
      at: number;
      state: "start" | "done" | "error";
      mode: "live" | "recorded";
      checks: number;
      measurements: number;
      ms: number;
    }
  | {
      kind: "log";
      seq: number;
      at: number;
      level: "info" | "warn" | "error";
      text: string;
    }
  | {
      kind: "reevaluated";
      seq: number;
      at: number;
      text: string;
    };

export type ModelCall = {
  seq: number;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  ms: number;
};

export type ExaminationView = {
  lastSeq: number;
  seen: Set<number>;
  status: ExaminationStatus;
  driver: Driver | null;
  model: string | null;
  rulebookVersion: number | null;
  pages: PageInfo[];
  measurements: Measurement[];
  hypotheses: Hypothesis[];
  findings: Finding[];
  verdict: VerdictResult | null;
  gate: DoneGate | null;
  feed: FeedItem[];
  tools: Record<string, ToolRun>;
  code: Record<string, CodeRun>;
  /** Where the Examiner is looking now. */
  look: { page: number; box: Box | null; seq: number } | null;
  skills: SkillId[];
  calls: ModelCall[];
  costUsd: number;
  ended: boolean;
  error: string | null;
  stoppedBy: StopReason | null;
  score: Score | null;
};

export function emptyView(
  status: ExaminationStatus = "queued",
): ExaminationView {
  return {
    lastSeq: 0,
    seen: new Set(),
    status,
    driver: null,
    model: null,
    rulebookVersion: null,
    pages: [],
    measurements: [],
    hypotheses: [],
    findings: [],
    verdict: null,
    gate: null,
    feed: [],
    tools: {},
    code: {},
    look: null,
    skills: [],
    calls: [],
    costUsd: 0,
    ended: false,
    error: null,
    stoppedBy: null,
    score: null,
  };
}

/** Folds events into a view. Returns the same object when nothing was new. */
export function applyEvents(
  view: ExaminationView,
  events: StoredEvent[],
): ExaminationView {
  let next: ExaminationView | null = null;
  for (const event of events) {
    // The stream's fallback `end` reuses the last seq: take an `end` once.
    const repeat = (next ?? view).seen.has(event.seq);
    if (repeat && !(event.type === "end" && !(next ?? view).ended)) continue;
    if (!next) {
      next = {
        ...view,
        seen: new Set(view.seen),
        feed: [...view.feed],
        tools: { ...view.tools },
        code: { ...view.code },
      };
    }
    next.seen.add(event.seq);
    next.lastSeq = Math.max(next.lastSeq, event.seq);
    const base = { seq: event.seq, at: event.at };
    switch (event.type) {
      case "start":
        next.status = "running";
        next.driver = event.driver;
        next.model = event.model;
        next.rulebookVersion = event.rulebookVersion;
        break;
      case "pages":
        next.pages = event.pages;
        break;
      case "sweep":
        next.feed = [
          ...next.feed.filter((item) => item.kind !== "sweep"),
          {
            kind: "sweep",
            ...base,
            state: event.state,
            mode: event.mode,
            checks: event.checks.length,
            measurements: event.measurements ?? 0,
            ms: event.ms ?? 0,
          },
        ];
        break;
      case "thought":
        next.feed.push({ kind: "thought", ...base, text: event.text });
        break;
      case "tool": {
        if (!next.tools[event.callId])
          next.feed.push({ kind: "tool", ...base, callId: event.callId });
        next.tools[event.callId] = {
          callId: event.callId,
          tool: event.tool,
          summary: event.summary,
          input: event.input,
          state: event.state,
          output: event.output ?? next.tools[event.callId]?.output ?? "",
          ms: event.ms ?? 0,
        };
        break;
      }
      case "look":
        next.look = { page: event.page, box: event.box, seq: event.seq };
        break;
      case "code":
        next.code[event.callId] = {
          callId: event.callId,
          check: event.check,
          code: event.code,
          stdout: event.stdout,
          stderr: event.stderr,
          exitCode: event.exitCode,
          ms: event.ms,
        };
        break;
      case "measurements": {
        const ids = new Set(event.measurements.map((item) => item.id));
        next.measurements = [
          ...next.measurements.filter((item) => !ids.has(item.id)),
          ...event.measurements,
        ];
        break;
      }
      case "hypothesis":
        next.hypotheses = [
          ...next.hypotheses.filter((item) => item.id !== event.hypothesis.id),
          event.hypothesis,
        ].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
        break;
      case "skill":
        if (!next.skills.includes(event.skill))
          next.skills = [...next.skills, event.skill];
        break;
      case "findings":
        next.findings = event.findings;
        next.verdict = event.verdict;
        next.rulebookVersion = event.rulebookVersion;
        break;
      case "gate":
        next.gate = event.gate;
        break;
      case "cost":
        next.calls = [
          ...next.calls,
          {
            seq: event.seq,
            model: event.model,
            costUsd: event.costUsd,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cachedInputTokens: event.cachedInputTokens,
            ms: event.ms,
          },
        ];
        next.costUsd += event.costUsd;
        break;
      case "log":
        next.feed.push({
          kind: "log",
          ...base,
          level: event.level,
          text: event.text,
        });
        break;
      case "reevaluated":
        next.feed.push({
          kind: "reevaluated",
          ...base,
          text: `Re-evaluated under Rulebook v${event.toVersion}: ${event.from} → ${event.to}. No model call.`,
        });
        break;
      case "end":
        next.status = event.status;
        next.ended = true;
        next.look = null;
        next.error = event.error ?? null;
        next.stoppedBy = event.stoppedBy ?? null;
        next.score = event.score ?? next.score;
        if (event.status === "failed") {
          next.verdict = null;
          if (next.gate?.pagesTotal === 0) next.gate = null;
        }
        break;
    }
  }
  return next ?? view;
}

/** A ref to a page image or an Evidence layer as a URL the browser can load. */
export function assetUrl(examinationId: string, ref: string) {
  return ref.startsWith("/")
    ? ref
    : `/api/loupe/examinations/${encodeURIComponent(examinationId)}/asset?key=${encodeURIComponent(ref)}`;
}

export const money = (usd: number) =>
  usd === 0 ? "$0" : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;

export const seconds = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
