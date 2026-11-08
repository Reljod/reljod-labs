import type { BuildPlan, Layout, PlanStep } from "./build-plan";

/** One stored Build of an Ask session. */
export type StoredBuild = {
  id: string;
  position: number;
  question: string;
  plan: BuildPlan;
  createdAt: string;
};

export type AskSessionView = {
  id: string;
  builds: StoredBuild[];
};

/** Newline-delimited JSON events streamed while Ledger plans a Build. */
export type BuildEvent =
  /** The plan's frame: known before the first step arrives. */
  | { type: "frame"; title: string; layout: Layout }
  /** More of the chat answer. */
  | { type: "answer"; delta: string }
  /** One validated step, ready to play. */
  | { type: "step"; step: PlanStep }
  /** The Build was stored; `build.plan` is what replays will play. */
  | { type: "done"; build: StoredBuild }
  | { type: "limited"; message: string; sessionId: string | null }
  | { type: "error"; message: string };

export const encodeEvent = (event: BuildEvent) => `${JSON.stringify(event)}\n`;

/** Splits a streamed body into events, keeping a partial last line for later. */
export function decodeEvents(buffer: string): {
  events: BuildEvent[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  return {
    events: lines
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as BuildEvent),
    rest,
  };
}
