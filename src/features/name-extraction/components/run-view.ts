/**
 * Folds a Run's events (the Audit trail) into what the page shows: the
 * timeline, the Readers, the Done gate, the cost meter and the Register. Pure,
 * so a live stream and a replay of a finished Run land in the same state.
 */
import type {
  DocumentSource,
  DoneGate,
  ExtractedName,
  ModelChoice,
  Purpose,
  RunEvent,
  RunStatus,
  Score,
  SkillId,
  ToolId,
} from "../domain/contract";
import { CODE_PENDING } from "../domain/contract";

export type SeqEvent = RunEvent & { seq: number };

export type CodeCell = {
  code: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

export type TimelineItem =
  | { kind: "thought"; seq: number; at: number; text: string }
  | {
      kind: "tool";
      seq: number;
      at: number;
      callId: string;
      tool: ToolId;
      summary: string;
      input: unknown;
      state: "start" | "done" | "error";
      output?: string;
      ms?: number;
      /** The code a `run_code` call ran, once it has run. */
      code?: CodeCell;
    }
  | { kind: "skill"; seq: number; at: number; skill: SkillId }
  | {
      kind: "log";
      seq: number;
      at: number;
      level: "info" | "warn" | "error";
      text: string;
    };

export type ReaderView = {
  readerId: string;
  from: number;
  to: number;
  state: "start" | "done" | "error";
  names?: number;
  ms?: number;
};

export type CostLine = {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type RunView = {
  /** Every event, in order: the Audit tab reads it as is. */
  events: SeqEvent[];
  lastSeq: number;
  document: { id: string; title: string; pages: number } | null;
  source: DocumentSource | null;
  models: ModelChoice | null;
  rulebookVersion: number | null;
  status: RunStatus;
  error: string | null;
  score: Score | null;
  startedAt: number | null;
  endedAt: number | null;
  timeline: TimelineItem[];
  readers: ReaderView[];
  gate: DoneGate | null;
  names: ExtractedName[];
  skills: SkillId[];
  /** Calls per tool, counted once per callId. */
  toolCounts: Partial<Record<ToolId, number>>;
  cost: {
    total: CostLine;
    byPurpose: Partial<Record<Purpose, CostLine>>;
    byModel: Record<string, CostLine>;
  };
};

const zeroCost = (): CostLine => ({
  calls: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
});

export const emptyRunView: RunView = {
  events: [],
  lastSeq: -1,
  document: null,
  source: null,
  models: null,
  rulebookVersion: null,
  status: "queued",
  error: null,
  score: null,
  startedAt: null,
  endedAt: null,
  timeline: [],
  readers: [],
  gate: null,
  names: [],
  skills: [],
  toolCounts: {},
  cost: { total: zeroCost(), byPurpose: {}, byModel: {} },
};

export function isOver(status: RunStatus) {
  return status === "completed" || status === "failed" || status === "stopped";
}

function addCost(line: CostLine | undefined, event: CostEvent): CostLine {
  const base = line ?? zeroCost();
  return {
    calls: base.calls + 1,
    costUsd: base.costUsd + event.costUsd,
    inputTokens: base.inputTokens + event.inputTokens,
    outputTokens: base.outputTokens + event.outputTokens,
    cachedInputTokens: base.cachedInputTokens + event.cachedInputTokens,
  };
}

type CostEvent = Extract<RunEvent, { type: "cost" }>;

const nameKey = (name: ExtractedName) => name.canonical.trim().toLowerCase();

/**
 * Adds or replaces Names by canonical form. A `names` event may carry the
 * whole Register or only what `record_names` just changed; either way the
 * latest word on a Name wins.
 */
export function mergeNames(
  current: ExtractedName[],
  incoming: ExtractedName[],
): ExtractedName[] {
  const byKey = new Map(current.map((name) => [nameKey(name), name]));
  for (const name of incoming) byKey.set(nameKey(name), name);
  return [...byKey.values()];
}

function upsertTool(
  timeline: TimelineItem[],
  callId: string,
  build: (
    existing: Extract<TimelineItem, { kind: "tool" }> | undefined,
  ) => Extract<TimelineItem, { kind: "tool" }>,
): TimelineItem[] {
  const index = timeline.findIndex(
    (item) => item.kind === "tool" && item.callId === callId,
  );
  if (index === -1) return [...timeline, build(undefined)];
  const next = timeline.slice();
  next[index] = build(
    timeline[index] as Extract<TimelineItem, { kind: "tool" }>,
  );
  return next;
}

/** Folds one event in. Events at or below the last seq seen are dropped (a reconnect may resend them). */
export function reduceRunView(view: RunView, event: SeqEvent): RunView {
  if (event.seq <= view.lastSeq) return view;
  // Nothing a stopped or failed Run reports afterwards changes it, except its cost.
  const over = isOver(view.status);
  const next: RunView = {
    ...view,
    events: [...view.events, event],
    lastSeq: event.seq,
  };
  const { seq, at } = event;
  switch (event.type) {
    case "start":
      return {
        ...next,
        document: event.document,
        source: event.source,
        models: event.models,
        rulebookVersion: event.rulebookVersion,
        status: over ? view.status : "running",
        startedAt: at,
      };
    case "thought":
      return {
        ...next,
        timeline: [
          ...view.timeline,
          { kind: "thought", seq, at, text: event.text },
        ],
      };
    case "tool": {
      const seen = view.timeline.some(
        (item) => item.kind === "tool" && item.callId === event.callId,
      );
      return {
        ...next,
        toolCounts: seen
          ? view.toolCounts
          : {
              ...view.toolCounts,
              [event.tool]: (view.toolCounts[event.tool] ?? 0) + 1,
            },
        timeline: upsertTool(view.timeline, event.callId, (existing) => ({
          kind: "tool",
          seq: existing?.seq ?? seq,
          at: existing?.at ?? at,
          callId: event.callId,
          tool: event.tool,
          summary: event.summary || existing?.summary || "",
          input: event.input ?? existing?.input,
          state: event.state,
          output: event.output ?? existing?.output,
          ms: event.ms ?? existing?.ms,
          code: existing?.code,
        })),
      };
    }
    case "code": {
      const cell: CodeCell = {
        code: event.code,
        stdout: event.stdout,
        stderr: event.stderr,
        exitCode: event.exitCode,
        ms: event.ms,
      };
      const seen = view.timeline.some(
        (item) => item.kind === "tool" && item.callId === event.callId,
      );
      return {
        ...next,
        toolCounts: seen
          ? view.toolCounts
          : {
              ...view.toolCounts,
              run_code: (view.toolCounts.run_code ?? 0) + 1,
            },
        timeline: upsertTool(view.timeline, event.callId, (existing) =>
          existing
            ? { ...existing, code: cell }
            : {
                kind: "tool",
                seq,
                at,
                callId: event.callId,
                tool: "run_code",
                summary: "",
                input: undefined,
                state:
                  event.exitCode === CODE_PENDING
                    ? "start"
                    : event.exitCode === 0
                      ? "done"
                      : "error",
                ms: event.ms,
                code: cell,
              },
        ),
      };
    }
    case "skill":
      return {
        ...next,
        skills: view.skills.includes(event.skill)
          ? view.skills
          : [...view.skills, event.skill],
        timeline: [
          ...view.timeline,
          { kind: "skill", seq, at, skill: event.skill },
        ],
      };
    case "reader": {
      const reader: ReaderView = {
        readerId: event.readerId,
        from: event.from,
        to: event.to,
        state: event.state,
        names: event.names,
        ms: event.ms,
      };
      const index = view.readers.findIndex(
        (item) => item.readerId === event.readerId,
      );
      const readers = view.readers.slice();
      if (index === -1) readers.push(reader);
      else
        readers[index] = {
          ...readers[index],
          ...reader,
          names: reader.names ?? readers[index].names,
          ms: reader.ms ?? readers[index].ms,
        };
      return { ...next, readers };
    }
    case "names":
      return { ...next, names: mergeNames(view.names, event.names) };
    case "gate":
      return { ...next, gate: event.gate };
    case "cost": {
      const byModel = { ...view.cost.byModel };
      byModel[event.model] = addCost(byModel[event.model], event);
      return {
        ...next,
        cost: {
          total: addCost(view.cost.total, event),
          byPurpose: {
            ...view.cost.byPurpose,
            [event.purpose]: addCost(view.cost.byPurpose[event.purpose], event),
          },
          byModel,
        },
      };
    }
    case "log":
      return {
        ...next,
        timeline: [
          ...view.timeline,
          { kind: "log", seq, at, level: event.level, text: event.text },
        ],
      };
    case "end": {
      if (over) return next;
      const stoppedState = event.status === "completed" ? "done" : "error";
      return {
        ...next,
        status: event.status,
        error: event.error ?? null,
        score: event.score ?? null,
        endedAt: at,
        // Nothing is still running once the Run has ended.
        readers: view.readers.map((reader) =>
          reader.state === "start"
            ? { ...reader, state: stoppedState }
            : reader,
        ),
        timeline: view.timeline.map((item) =>
          item.kind === "tool" && item.state === "start"
            ? { ...item, state: stoppedState }
            : item,
        ),
      };
    }
    default:
      return next;
  }
}

/** Gives events without a seq (an older stream) their place in order. */
export function withSeq(event: RunEvent & { seq?: number }, fallback: number) {
  return {
    ...event,
    seq: typeof event.seq === "number" ? event.seq : fallback,
  } as SeqEvent;
}

export function foldEvents(events: SeqEvent[], from: RunView = emptyRunView) {
  return events.reduce(reduceRunView, from);
}

// The agent diagram --------------------------------------------------------------

/** The parts of the Analyst's toolkit drawn in "How Sieve is built". */
export const TOOLKIT_NODES = [
  "readers",
  "skills",
  "sandbox",
  "sweep",
  "pages",
  "register",
  "gate",
  "mcp",
] as const;
export type ToolkitNode = (typeof TOOLKIT_NODES)[number];

export const TOOL_NODE: Record<ToolId, ToolkitNode> = {
  outline: "sweep",
  read_pages: "pages",
  grep: "pages",
  run_code: "sandbox",
  spawn_readers: "readers",
  load_skill: "skills",
  record_names: "register",
  finish: "gate",
};

/** The toolkit node an event touches, if any. */
export function nodeOfEvent(event: RunEvent): ToolkitNode | null {
  switch (event.type) {
    case "tool":
      return TOOL_NODE[event.tool] ?? null;
    case "code":
      return "sandbox";
    case "skill":
      return "skills";
    case "reader":
      return "readers";
    case "names":
      return "register";
    case "gate":
      return "gate";
    default:
      return null;
  }
}

/** Nodes with work in flight, plus the node the latest event touched. */
export function liveNodes(view: RunView): Set<ToolkitNode> {
  const live = new Set<ToolkitNode>();
  if (isOver(view.status)) return live;
  for (const item of view.timeline)
    if (item.kind === "tool" && item.state === "start")
      live.add(TOOL_NODE[item.tool]);
  if (view.readers.some((reader) => reader.state === "start"))
    live.add("readers");
  for (let index = view.events.length - 1; index >= 0; index--) {
    const node = nodeOfEvent(view.events[index]);
    if (node) {
      live.add(node);
      break;
    }
    if (view.events[index].type === "thought") break;
  }
  return live;
}

/** How many times each node was used in the Run. */
export function nodeCounts(
  view: RunView,
): Partial<Record<ToolkitNode, number>> {
  const counts: Partial<Record<ToolkitNode, number>> = {};
  for (const [tool, count] of Object.entries(view.toolCounts) as [
    ToolId,
    number,
  ][]) {
    const node = TOOL_NODE[tool];
    counts[node] = (counts[node] ?? 0) + count;
  }
  if (view.readers.length > 0) counts.readers = view.readers.length;
  if (view.skills.length > 0) counts.skills = view.skills.length;
  return counts;
}
