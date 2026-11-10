import type {
  BuildEvent,
  BuildStats,
  JobId,
  Persona,
  SourceView,
  Usage,
} from "./events";
import {
  type AppliedRepair,
  applyRepairs,
  type DraftGraph,
  edgeKey,
  type Issue,
} from "./graph";

/**
 * A Build as the browser sees it: the event stream folded into the Jobs'
 * progress and a live Draft graph. Repairs are replayed with the same
 * `applyRepairs` the server ran, so the drawing matches what gets committed.
 */

export type JobRun = {
  job: JobId;
  round: number;
  state: "start" | "done" | "error" | "skip";
  detail?: string;
  ms?: number;
  startedAt: number;
};

export type Departure = {
  key: string;
  /** Where a merged Node goes before it disappears. */
  into?: string;
  at: number;
};

export type BuildState = {
  received: number;
  runs: JobRun[];
  sources: SourceView[];
  graph: DraftGraph;
  /** Arrival order of every Node, for stagger and "new" sparkle. */
  arrivals: Record<string, number>;
  issues: { round: number; issues: Issue[] }[];
  repairs: { round: number; repair: AppliedRepair; at: number }[];
  departures: Departure[];
  usages: Usage[];
  persona: Persona | null;
  portraitUrl: string | null;
  logs: { level: "info" | "warn" | "error"; text: string; at: number }[];
  end: {
    status: "completed" | "failed" | "stopped";
    error?: string;
    stats?: BuildStats;
  } | null;
};

export function initialBuildState(graph?: DraftGraph): BuildState {
  return {
    received: 0,
    runs: [],
    sources: [],
    graph: graph ?? { nodes: [], edges: [] },
    arrivals: {},
    issues: [],
    repairs: [],
    departures: [],
    usages: [],
    persona: null,
    portraitUrl: null,
    logs: [],
    end: null,
  };
}

export function buildReducer(state: BuildState, event: BuildEvent): BuildState {
  const next = { ...state, received: state.received + 1 };
  switch (event.type) {
    case "job": {
      const round = event.round ?? 0;
      const index = state.runs.findIndex(
        (run) => run.job === event.job && run.round === round,
      );
      const run: JobRun = {
        job: event.job,
        round,
        state: event.state,
        detail: event.detail ?? state.runs[index]?.detail,
        ms: event.ms,
        startedAt:
          index >= 0 ? (state.runs[index]?.startedAt ?? event.at) : event.at,
      };
      const runs = [...state.runs];
      if (index >= 0) runs[index] = run;
      else runs.push(run);
      return { ...next, runs };
    }
    case "source":
      return { ...next, sources: [...state.sources, event.source] };
    case "node": {
      const existing = state.graph.nodes.findIndex(
        (node) => node.key === event.node.key,
      );
      if (existing >= 0) {
        const nodes = [...state.graph.nodes];
        const current = nodes[existing];
        if (current) {
          nodes[existing] = {
            ...current,
            attributes: { ...event.node.attributes, ...current.attributes },
            evidence: [...current.evidence, ...event.node.evidence],
            summary: current.summary || event.node.summary,
          };
        }
        return { ...next, graph: { ...state.graph, nodes } };
      }
      return {
        ...next,
        graph: { ...state.graph, nodes: [...state.graph.nodes, event.node] },
        arrivals: {
          ...state.arrivals,
          [event.node.key]: Object.keys(state.arrivals).length,
        },
      };
    }
    case "edge": {
      const key = edgeKey(event.edge);
      if (state.graph.edges.some((edge) => edgeKey(edge) === key)) return next;
      return {
        ...next,
        graph: { ...state.graph, edges: [...state.graph.edges, event.edge] },
      };
    }
    case "issues":
      return {
        ...next,
        issues: [...state.issues, { round: event.round, issues: event.issues }],
      };
    case "repair": {
      const { graph } = applyRepairs(
        state.graph,
        [event.repair],
        event.repair.by,
      );
      const repair = event.repair;
      const departures = [...state.departures];
      if (repair.op === "remove_node")
        departures.push({ key: repair.key, at: event.at });
      if (repair.op === "merge_nodes") {
        departures.push({ key: repair.drop, into: repair.keep, at: event.at });
      }
      return {
        ...next,
        graph,
        departures,
        repairs: [
          ...state.repairs,
          { round: event.round, repair, at: event.at },
        ],
      };
    }
    case "usage":
      return { ...next, usages: [...state.usages, event.usage] };
    case "persona":
      return { ...next, persona: event.persona };
    case "portrait":
      return { ...next, portraitUrl: event.url };
    case "log":
      return {
        ...next,
        logs: [
          ...state.logs,
          { level: event.level, text: event.text, at: event.at },
        ].slice(-200),
      };
    case "end":
      return {
        ...next,
        end: { status: event.status, error: event.error, stats: event.stats },
      };
  }
}

export function spendOf(state: BuildState) {
  return state.usages.reduce(
    (total, usage) => ({
      costUsd: total.costUsd + (usage.costUsd ?? 0),
      tokens: total.tokens + usage.inputTokens + usage.outputTokens,
    }),
    { costUsd: 0, tokens: 0 },
  );
}

/** The Job a Build is on now, for the one-line status. */
export function currentRun(state: BuildState): JobRun | undefined {
  return (
    [...state.runs].reverse().find((run) => run.state === "start") ??
    state.runs.at(-1)
  );
}
