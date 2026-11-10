import { describe, expect, it } from "vitest";
import { buildReducer, initialBuildState, spendOf } from "./build-state";
import type { BuildEvent } from "./events";
import { applyRepairs, type DraftNode, emptyGraph, ROOT_KEY } from "./graph";
import { describeStep, highlightFrom } from "./traversal";

const node = (key: string, category: DraftNode["category"]): DraftNode => ({
  key,
  label: key.split(":")[1] ?? key,
  type: "person",
  category,
  summary: "",
  attributes: {},
  confidence: 0.9,
  evidence: [{ sourceId: "s1", quote: key }],
});

const at = 1_000;
const fold = (events: BuildEvent[], start = initialBuildState()) =>
  events.reduce(buildReducer, start);

describe("buildReducer", () => {
  it("tracks Jobs per round and folds streamed Nodes and Edges", () => {
    const state = fold([
      { at, type: "job", job: "extract", state: "start" },
      {
        at,
        type: "node",
        node: node("person:paolo", "network.family"),
        sourceId: "s1",
      },
      {
        at,
        type: "node",
        node: node("person:paolo", "network.family"),
        sourceId: "s2",
      },
      {
        at,
        type: "edge",
        edge: {
          from: ROOT_KEY,
          to: "person:paolo",
          relation: "MARRIED_TO",
          label: "is married to",
          confidence: 1,
          evidence: [],
        },
        sourceId: "s1",
      },
      {
        at,
        type: "edge",
        edge: {
          from: ROOT_KEY,
          to: "person:paolo",
          relation: "MARRIED_TO",
          label: "is married to",
          confidence: 1,
          evidence: [],
        },
        sourceId: "s2",
      },
      {
        at: at + 50,
        type: "job",
        job: "extract",
        state: "done",
        detail: "1 Node",
        ms: 50,
      },
      { at, type: "job", job: "check", state: "start", round: 1 },
      { at, type: "job", job: "check", state: "done", round: 1 },
      { at, type: "job", job: "check", state: "start", round: 2 },
    ]);
    expect(state.graph.nodes).toHaveLength(1);
    expect(state.graph.nodes[0]?.evidence).toHaveLength(2);
    expect(state.graph.edges).toHaveLength(1);
    expect(
      state.runs.map((run) => `${run.job}:${run.round}:${run.state}`),
    ).toEqual(["extract:0:done", "check:1:done", "check:2:start"]);
    expect(state.runs[0]?.detail).toBe("1 Node");
  });

  it("replays Repairs exactly as the server applied them", () => {
    const base = {
      nodes: [
        ...emptyGraph("Maria").nodes,
        node("person:paolo", "network.family"),
        node("person:paolo-santos", "network.social"),
      ],
      edges: [],
    };
    const repair = {
      op: "merge_nodes" as const,
      keep: "person:paolo",
      drop: "person:paolo-santos",
      reason: "same person",
    };
    const server = applyRepairs(base, [repair], "critic");
    const applied = server.applied[0];
    if (!applied) throw new Error("not applied");
    const state = fold(
      [{ at, type: "repair", round: 1, repair: applied }],
      initialBuildState(base),
    );
    expect(state.graph).toEqual(server.graph);
    expect(state.departures).toEqual([
      { key: "person:paolo-santos", into: "person:paolo", at },
    ]);
  });

  it("adds up spend", () => {
    const state = fold([
      {
        at,
        type: "usage",
        usage: {
          purpose: "extract",
          model: "m",
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.01,
          ms: 1,
        },
      },
      {
        at,
        type: "usage",
        usage: {
          purpose: "embed",
          model: "e",
          inputTokens: 3,
          outputTokens: 0,
          costUsd: null,
          ms: 1,
        },
      },
      { at, type: "end", status: "stopped", error: "Stopped" },
    ]);
    expect(spendOf(state)).toEqual({ costUsd: 0.01, tokens: 18 });
    expect(state.end?.status).toBe("stopped");
  });
});

describe("highlightFrom", () => {
  it("lights seeds, then what the walk reached in order, and keeps the strongest glow", () => {
    const lit = highlightFrom([
      {
        kind: "search",
        query: "cottage",
        hits: [{ key: "asset:cottage", score: 0.03 }],
      },
      {
        kind: "expand",
        from: ["asset:cottage"],
        hops: 1,
        reached: [
          { key: "person:ivy", depth: 1, via: "goal:gift|BENEFITS|person:ivy" },
          { key: "asset:cottage", depth: 0, via: null },
        ],
      },
      { kind: "read", keys: ["person:ivy"] },
    ]);
    expect(lit.nodes.get("asset:cottage")).toMatchObject({
      glow: "seed",
      order: 0,
    });
    expect(lit.nodes.get("person:ivy")).toMatchObject({
      glow: "read",
      depth: 1,
    });
    expect(lit.edges.has("goal:gift|BENEFITS|person:ivy")).toBe(true);
    expect(lit.focus).toEqual(["person:ivy"]);
  });

  it("marks a path's Nodes and Edges as the path", () => {
    const lit = highlightFrom([
      {
        kind: "path",
        from: "a",
        to: "c",
        nodes: ["a", "b", "c"],
        edges: ["a|X|b", "b|Y|c"],
      },
    ]);
    expect([...lit.nodes.values()].every((item) => item.glow === "path")).toBe(
      true,
    );
    expect([...lit.edges.keys()]).toEqual(["a|X|b", "b|Y|c"]);
    expect(
      describeStep(
        { kind: "path", from: "a", to: "c", nodes: ["a", "b", "c"], edges: [] },
        (key) => key.toUpperCase(),
      ),
    ).toEqual({
      title: "Connected A → C",
      detail: "2 hops via B",
    });
  });
});
