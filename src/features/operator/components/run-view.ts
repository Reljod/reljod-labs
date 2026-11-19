/**
 * Folds a Run's events (the Trail) into what the page shows: the Frames, the
 * timeline grouped by Turn, the pending Approval, the checklist, the cost and
 * the Verdict. Pure, so a live stream, a finished Run and a recorded Run all
 * land in the same state.
 */
import type { ScreenAction } from "../domain/actions";
import type { Finding, FindingLevel, Verdict } from "../domain/checks";
import {
  type Driver,
  type FrameEvent,
  isOver,
  type ModelId,
  type PendingApproval,
  type RunDetail,
  type RunEvent,
  type RunStatus,
  type StopReason,
} from "../domain/contract";
import type { RuleId } from "../domain/rules";
import type { ScreenCode } from "../legacy/types";

export { isOver };

/** One Action under a Turn: the Frame it made. */
export type ActionChip = {
  /** The Frame's number. */
  n: number;
  label: string;
  /** What kind of Action; `start` for the sign-on Frame. */
  kind: ScreenAction["type"] | "start";
  screen: ScreenCode;
  /** HARBOURMASTER's message line after it, if any. */
  message: string;
  /** Records it committed. */
  changes: number;
};

export type Decision = "approved" | "refused" | "expired";

type Base = {
  /** Stable across re-folds: the seq of the event that made the item. */
  id: string;
  seq: number;
  /** The Frame the screen jumps to when the item is clicked; null before any Frame. */
  frame: number | null;
};

export type TimelineItem =
  | (Base & { kind: "turn"; turn: number; intent: string; chips: ActionChip[] })
  | (Base & {
      kind: "rule";
      ruleId: RuleId;
      outcome: "refused" | "paused";
      reason: string;
      label: string;
      screen: ScreenCode;
    })
  | (Base & {
      kind: "pause";
      pending: PendingApproval;
      decision: Decision | null;
      note: string | null;
    })
  | (Base & { kind: "skill"; skillId: string; title: string })
  | (Base & {
      kind: "code";
      callId: string;
      code: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      ms: number;
    })
  | (Base & { kind: "log"; level: "info" | "warn" | "error"; text: string });

export type PlanItem = { text: string; done: boolean };

export type RunView = {
  /** Every event, in seq order and each seq once. */
  events: RunEvent[];
  /** The highest seq folded in; -1 before any. */
  lastSeq: number;
  status: RunStatus;
  driver: Driver | null;
  task: { id: string | null; title: string; brief: string } | null;
  manifest: { name: string; rows: number } | null;
  model: ModelId | null;
  rulebookVersion: number | null;
  startedAt: number | null;
  endedAt: number | null;
  /** In Frame order, each Frame once. */
  frames: FrameEvent[];
  timeline: TimelineItem[];
  /** The guarded Action the Run is paused on. */
  pending: PendingApproval | null;
  /** The Operator's plan each time it changed. */
  plans: { seq: number; items: PlanItem[] }[];
  /** The Expectations the Books met each time code looked. */
  progress: { seq: number; met: boolean[] }[];
  /** One entry per model call. */
  costs: { seq: number; turn: number; costUsd: number }[];
  costUsd: number;
  verdict: Verdict | null;
  findings: Finding[];
  stoppedBy: StopReason | null;
  error: string | null;
  summary: string | null;
};

export const emptyRunView: RunView = {
  events: [],
  lastSeq: -1,
  status: "queued",
  driver: null,
  task: null,
  manifest: null,
  model: null,
  rulebookVersion: null,
  startedAt: null,
  endedAt: null,
  frames: [],
  timeline: [],
  pending: null,
  plans: [],
  progress: [],
  costs: [],
  costUsd: 0,
  verdict: null,
  findings: [],
  stoppedBy: null,
  error: null,
  summary: null,
};

/** Where `seq` is, or belongs, in events sorted by seq. */
function seqIndex(events: RunEvent[], seq: number) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].seq < seq) low = middle + 1;
    else high = middle;
  }
  return { index: low, found: events[low]?.seq === seq };
}

/** The first line of what the Operator said, as its one-line intent. */
export function oneLine(text: string) {
  const line = text.split("\n").find((part) => part.trim()) ?? "";
  return line.trim().replace(/\s+/g, " ");
}

const lastFrame = (view: RunView) =>
  view.frames.length > 0 ? view.frames[view.frames.length - 1].n : null;

/** The timeline with its last item replaced. Every other item keeps its identity. */
const replaceLast = (timeline: TimelineItem[], item: TimelineItem) => [
  ...timeline.slice(0, -1),
  item,
];

function chipOf(frame: FrameEvent): ActionChip {
  return {
    n: frame.n,
    label: frame.label,
    kind: frame.action?.type ?? "start",
    screen: frame.screen,
    message: frame.message,
    changes: frame.changes.length,
  };
}

/**
 * The Turn item an event of `turn` goes into: the last item, when it is that
 * Turn's and has not moved on to another intent. Anything else (a Rule that
 * fired, a pause) closes it, so the timeline stays in the order things happened.
 */
function openTurn(timeline: TimelineItem[], turn: number, intent: string) {
  const last = timeline[timeline.length - 1];
  if (last?.kind !== "turn" || last.turn !== turn) return null;
  if (intent && last.intent && intent !== last.intent && last.chips.length > 0)
    return null;
  return last;
}

function withFrame(view: RunView, frame: FrameEvent): RunView {
  if (view.frames.some((item) => item.n === frame.n)) return view;
  const frames = [...view.frames, frame];
  if (frames.length > 1 && frames[frames.length - 2].n > frame.n)
    frames.sort((a, b) => a.n - b.n);
  const intent = oneLine(frame.intent);
  const open = openTurn(view.timeline, frame.turn, intent);
  const chip = chipOf(frame);
  const timeline = open
    ? replaceLast(view.timeline, {
        ...open,
        intent: intent || open.intent,
        frame: open.frame ?? frame.n,
        chips: [...open.chips, chip],
      })
    : [
        ...view.timeline,
        {
          kind: "turn" as const,
          id: `turn-${frame.seq}`,
          seq: frame.seq,
          turn: frame.turn,
          intent,
          frame: frame.n,
          chips: [chip],
        },
      ];
  return { ...view, frames, timeline };
}

function withThought(
  view: RunView,
  event: Extract<RunEvent, { type: "thought" }>,
): RunView {
  const intent = oneLine(event.text);
  const open = openTurn(view.timeline, event.turn, "");
  // What it said first is the intent; a later remark in the same Turn does not replace it.
  if (open)
    return open.intent
      ? view
      : { ...view, timeline: replaceLast(view.timeline, { ...open, intent }) };
  return {
    ...view,
    timeline: [
      ...view.timeline,
      {
        kind: "turn",
        id: `turn-${event.seq}`,
        seq: event.seq,
        turn: event.turn,
        intent,
        frame: null,
        chips: [],
      },
    ],
  };
}

function withCode(
  view: RunView,
  event: Extract<RunEvent, { type: "code" }>,
): RunView {
  const at = view.timeline.findIndex(
    (item) => item.kind === "code" && item.callId === event.callId,
  );
  const fields = {
    code: event.code,
    exitCode: event.exitCode,
    stdout: event.stdout,
    stderr: event.stderr,
    ms: event.ms,
  };
  if (at < 0)
    return {
      ...view,
      timeline: [
        ...view.timeline,
        {
          kind: "code",
          id: `code-${event.callId}`,
          seq: event.seq,
          frame: lastFrame(view),
          callId: event.callId,
          ...fields,
        },
      ],
    };
  const timeline = view.timeline.slice();
  timeline[at] = { ...(timeline[at] as TimelineItem), ...fields };
  return { ...view, timeline };
}

function withDecision(
  view: RunView,
  event: Extract<RunEvent, { type: "decision" }>,
): RunView {
  const timeline = view.timeline.map((item) =>
    item.kind === "pause" && item.pending.approvalId === event.approvalId
      ? { ...item, decision: event.decision, note: event.note ?? null }
      : item,
  );
  const cleared = view.pending?.approvalId === event.approvalId;
  return {
    ...view,
    timeline,
    pending: cleared ? null : view.pending,
    status: cleared && view.status === "paused" ? "running" : view.status,
  };
}

/** Folds one event in. An event already folded (same seq) changes nothing. */
export function reduceRunView(view: RunView, event: RunEvent): RunView {
  const place = seqIndex(view.events, event.seq);
  const over = isOver(view.status);
  // A stream may send an event twice, and may end on a seq it already used.
  if (place.found && (event.type !== "end" || over)) return view;
  const events = place.found
    ? view.events
    : place.index === view.events.length
      ? [...view.events, event]
      : [
          ...view.events.slice(0, place.index),
          event,
          ...view.events.slice(place.index),
        ];
  const next: RunView = {
    ...view,
    events,
    lastSeq: Math.max(view.lastSeq, event.seq),
  };
  // Nothing an ended Run reports afterwards changes it, except its checks and its cost.
  if (over && event.type !== "findings" && event.type !== "cost") return next;

  switch (event.type) {
    case "start":
      return {
        ...next,
        status: "running",
        driver: event.driver,
        task: event.task,
        manifest: event.manifest,
        model: event.model,
        rulebookVersion: event.rulebookVersion,
        startedAt: event.at,
      };
    case "thought":
      return withThought(next, event);
    case "frame":
      return withFrame(next, event);
    case "cost":
      return {
        ...next,
        costs: [
          ...next.costs,
          { seq: event.seq, turn: event.turn, costUsd: event.costUsd },
        ],
        costUsd: next.costUsd + event.costUsd,
      };
    case "rule":
      return {
        ...next,
        timeline: [
          ...next.timeline,
          {
            kind: "rule",
            id: `rule-${event.seq}`,
            seq: event.seq,
            frame: event.frame,
            ruleId: event.ruleId,
            outcome: event.outcome,
            reason: event.reason,
            label: event.label,
            screen: event.screen,
          },
        ],
      };
    case "pause":
      return {
        ...next,
        status: "paused",
        pending: event.pending,
        timeline: [
          ...next.timeline,
          {
            kind: "pause",
            id: `pause-${event.pending.approvalId}`,
            seq: event.seq,
            frame: event.pending.frame,
            pending: event.pending,
            decision: null,
            note: null,
          },
        ],
      };
    case "decision":
      return withDecision(next, event);
    case "skill":
      return {
        ...next,
        timeline: [
          ...next.timeline,
          {
            kind: "skill",
            id: `skill-${event.seq}`,
            seq: event.seq,
            frame: lastFrame(next),
            skillId: event.id,
            title: event.title,
          },
        ],
      };
    case "code":
      return withCode(next, event);
    case "log":
      return {
        ...next,
        timeline: [
          ...next.timeline,
          {
            kind: "log",
            id: `log-${event.seq}`,
            seq: event.seq,
            frame: lastFrame(next),
            level: event.level,
            text: event.text,
          },
        ],
      };
    case "plan":
      return {
        ...next,
        plans: [...next.plans, { seq: event.seq, items: event.items }],
      };
    case "progress":
      return {
        ...next,
        progress: [...next.progress, { seq: event.seq, met: event.met }],
      };
    case "findings":
      return { ...next, verdict: event.verdict, findings: event.findings };
    case "end":
      return {
        ...next,
        status: event.status,
        pending: null,
        endedAt: event.at,
        stoppedBy: event.stoppedBy ?? null,
        error: event.error ?? null,
        summary: event.summary ?? null,
      };
  }
}

export function foldEvents(events: RunEvent[], from: RunView = emptyRunView) {
  return events.reduce(reduceRunView, from);
}

/**
 * A stored Run as a view: its Trail folded, with the row as the last word on
 * what the Trail may not say yet (a status the workflow set before writing
 * `end`, Findings kept on the row, the Approval it is paused on).
 */
export function viewOfDetail(detail: RunDetail): RunView {
  const folded = foldEvents(
    detail.events.slice().sort((a, b) => a.seq - b.seq),
  );
  const over = isOver(folded.status);
  const status = over ? folded.status : detail.status;
  const started = Date.parse(detail.startedAt);
  const ended = detail.endedAt ? Date.parse(detail.endedAt) : Number.NaN;
  return {
    ...folded,
    status,
    driver: folded.driver ?? detail.driver,
    task: folded.task ?? {
      id: detail.taskId,
      title: detail.title,
      brief: detail.brief,
    },
    model: folded.model ?? detail.model,
    rulebookVersion: folded.rulebookVersion ?? detail.rulebookVersion,
    startedAt: folded.startedAt ?? (Number.isFinite(started) ? started : null),
    endedAt: folded.endedAt ?? (Number.isFinite(ended) ? ended : null),
    pending: isOver(status) ? null : (folded.pending ?? detail.pending),
    costUsd: Math.max(folded.costUsd, detail.costUsd),
    verdict: folded.verdict ?? detail.verdict,
    findings: folded.findings.length > 0 ? folded.findings : detail.findings,
    stoppedBy: folded.stoppedBy ?? detail.stoppedBy,
    error: folded.error ?? detail.error,
  };
}

/** The stored Run brought up to what the live view knows, for the places that take a RunDetail. */
export function detailOfView(detail: RunDetail, view: RunView): RunDetail {
  return {
    ...detail,
    events: view.events,
    status: view.status,
    stoppedBy: view.stoppedBy ?? detail.stoppedBy,
    verdict: view.verdict ?? detail.verdict,
    findings: view.findings.length > 0 ? view.findings : detail.findings,
    error: view.error ?? detail.error,
    costUsd: Math.max(view.costUsd, detail.costUsd),
    pending: view.pending,
    endedAt:
      detail.endedAt ??
      (view.endedAt === null ? null : new Date(view.endedAt).toISOString()),
  };
}

// What the screen shows at one Frame ----------------------------------------------------

export type FrameStatus = {
  turn: number;
  /** Actions taken up to and including this Frame. */
  actions: number;
  /** What the model calls up to this Frame's Turn cost. */
  costUsd: number;
  /** From the start of the Run to this Frame, ms. */
  elapsedMs: number;
};

/** The Run as it stood at Frame `index` (an index into `view.frames`). */
export function statusAt(view: RunView, index: number): FrameStatus {
  const frame = view.frames[index];
  if (!frame) return { turn: 0, actions: 0, costUsd: 0, elapsedMs: 0 };
  let actions = 0;
  for (let at = 0; at <= index; at++)
    if (view.frames[at].action !== null) actions++;
  let costUsd = 0;
  for (const cost of view.costs)
    if (cost.turn <= frame.turn) costUsd += cost.costUsd;
  return {
    turn: frame.turn,
    actions,
    costUsd,
    elapsedMs: Math.max(0, frame.at - (view.startedAt ?? frame.at)),
  };
}

/** The last entry at or before `seq`: what was known when that event happened. */
function latestAt<T extends { seq: number }>(entries: T[], seq: number) {
  let found: T | null = null;
  for (const entry of entries) {
    if (entry.seq > seq) break;
    found = entry;
  }
  return found;
}

/**
 * The seq up to which the checklist and the plan are read: everything, at the
 * newest Frame; otherwise up to just before the next Frame, so a check that
 * ran after an Action shows with that Action.
 */
export function seqHorizon(view: RunView, index: number) {
  const next = view.frames[index + 1];
  return next ? next.seq - 1 : Number.POSITIVE_INFINITY;
}

/** Which Expectations the Books met at Frame `index`, one flag per Expectation. */
export function metAt(view: RunView, index: number, count: number) {
  const met =
    latestAt(view.progress, seqHorizon(view, index))?.met ?? ([] as boolean[]);
  return Array.from({ length: count }, (_, at) => met[at] === true);
}

/** The Operator's plan as it stood at Frame `index`. */
export function planAt(view: RunView, index: number): PlanItem[] {
  return latestAt(view.plans, seqHorizon(view, index))?.items ?? [];
}

/** The timeline item the screen is on at Frame `n`: the Turn that made it, else the last item before it. */
export function activeItemId(timeline: TimelineItem[], n: number | null) {
  if (n === null) return null;
  let fallback: string | null = null;
  for (const item of timeline) {
    if (item.kind === "turn" && item.chips.some((chip) => chip.n === n))
      return item.id;
    if (item.frame !== null && item.frame <= n) fallback = item.id;
  }
  return fallback;
}

/** The pause that happened on Frame `n`, for the note under the screen. */
export function pauseAt(timeline: TimelineItem[], n: number | null) {
  if (n === null) return null;
  for (const item of timeline)
    if (item.kind === "pause" && item.pending.frame === n) return item;
  return null;
}

// Findings ----------------------------------------------------------------------------

const LEVEL_ORDER: FindingLevel[] = ["fail", "warn", "pass", "info"];

/** Findings grouped by level, the ones that failed first. Empty levels are left out. */
export function groupFindings(findings: Finding[]) {
  return LEVEL_ORDER.map((level) => ({
    level,
    findings: findings.filter((finding) => finding.level === level),
  })).filter((group) => group.findings.length > 0);
}
