import type { AppliedRepair, DraftEdge, DraftNode, Issue } from "./graph";

/** The Build's Jobs, in the order they run. */
export const JOBS = [
  "gather",
  "extract",
  "check",
  "critique",
  "repair",
  "commit",
  "embed",
  "persona",
] as const;
export type JobId = (typeof JOBS)[number];

export const JOB_LABELS: Record<JobId, { title: string; verb: string }> = {
  gather: { title: "Gather", verb: "Reading the Sources" },
  extract: { title: "Extract", verb: "Pulling out facts and links" },
  check: { title: "Check", verb: "Checking every fact against its quote" },
  critique: { title: "Critique", verb: "A second model looks for mistakes" },
  repair: { title: "Repair", verb: "Fixing what the checks found" },
  commit: { title: "Commit", verb: "Writing the graph to Postgres" },
  embed: { title: "Embed", verb: "Indexing Nodes for search" },
  persona: { title: "Persona", verb: "Inferring a persona and a portrait" },
};

export type SourceKind = "note" | "pdf" | "image" | "sheet" | "doc" | "text";

export type SourceView = {
  id: string;
  name: string;
  kind: SourceKind;
  mediaType: string;
  chars: number;
};

export type Persona = {
  archetype: string;
  headline: string;
  traits: string[];
  communication: string;
  riskAppetite: "low" | "moderate" | "high" | "unknown";
  /** What a wealth manager might ask about this client next. */
  questions: string[];
  portraitPrompt: string;
};

export type Usage = {
  purpose: "extract" | "critique" | "embed" | "persona" | "portrait" | "chat";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  ms: number;
};

export type BuildStats = {
  nodes: number;
  edges: number;
  branches: number;
  repairs: number;
  rounds: number;
  costUsd: number;
  tokens: number;
  ms: number;
};

export type BuildEvent = { at: number } & (
  | {
      type: "job";
      job: JobId;
      state: "start" | "done" | "error" | "skip";
      detail?: string;
      ms?: number;
      round?: number;
    }
  | { type: "source"; source: SourceView }
  | { type: "node"; node: DraftNode; sourceId: string }
  | { type: "edge"; edge: DraftEdge; sourceId: string }
  | { type: "issues"; round: number; issues: Issue[] }
  | { type: "repair"; round: number; repair: AppliedRepair }
  | { type: "usage"; usage: Usage }
  | { type: "persona"; persona: Persona }
  | { type: "portrait"; url: string }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | {
      type: "end";
      status: "completed" | "failed" | "stopped";
      error?: string;
      stats?: BuildStats;
    }
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type BuildEventInput = DistributiveOmit<BuildEvent, "at">;

// GraphRAG ----------------------------------------------------------------------

/** One move the Navigator makes through the graph, as the view replays it. */
export type TraversalStep =
  | {
      kind: "search";
      query: string;
      hits: { key: string; score: number }[];
    }
  | {
      kind: "expand";
      from: string[];
      hops: number;
      reached: { key: string; depth: number; via: string | null }[];
    }
  | {
      kind: "path";
      from: string;
      to: string;
      nodes: string[];
      edges: string[];
    }
  | { kind: "category"; category: string; keys: string[] }
  | { kind: "read"; keys: string[] };

export type ChatEvent =
  /** A tool call began: the transcript shows it running until its step lands. */
  | { type: "tool"; callId: string; name: ToolName; input: unknown }
  | {
      type: "step";
      callId?: string;
      step: TraversalStep;
      /** The SQL that ran, shown in the trace. */
      sql: string;
      ms: number;
    }
  | { type: "tool-result"; callId: string; ok: boolean; summary: string }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "usage"; usage: Usage }
  | { type: "build"; buildId: string }
  | { type: "done"; messageId: string | null; cited: string[] }
  | { type: "error"; message: string };

export const TOOL_NAMES = [
  "search_graph",
  "expand",
  "connect",
  "browse_category",
  "read",
  "record_facts",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const MAX_MESSAGE_LENGTH = 2000;
