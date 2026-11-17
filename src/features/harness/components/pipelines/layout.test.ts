import { describe, expect, it } from "vitest";
import type { StepSpec } from "../../domain/pipeline";
import {
  BAND_PAD,
  fitGraph,
  GAP_X,
  GRAPH_PAD,
  layoutPipeline,
  MAX_NODE_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_HEIGHT,
  NODE_WIDTH,
  specForRun,
} from "./layout";

const step = (id: string, after: string[] = []): StepSpec => ({
  id,
  title: id.toUpperCase(),
  kind: "code",
  after,
  summary: "",
});

describe("layoutPipeline", () => {
  const spec = {
    steps: [
      step("read"),
      step("rules", ["read"]),
      step("limits", ["read"]),
      step("decide", ["rules", "limits"]),
    ],
  };

  it("puts Steps that can run together side by side on one row", () => {
    const layout = layoutPipeline(spec);
    const at = (id: string) => {
      const found = layout.nodes.find((n) => n.step.id === id);
      if (!found) throw new Error(`no node ${id}`);
      return found;
    };
    expect(at("read").level).toBe(0);
    expect(at("rules").y).toBe(at("limits").y);
    expect(at("rules").x).toBeLessThan(at("limits").x);
    expect(at("limits").x - at("rules").x).toBe(NODE_WIDTH + GAP_X);
    expect(at("decide").y).toBeGreaterThan(at("rules").y);
    expect(layout.parallelism).toBe(2);
  });

  it("centres a narrower row under a wider one", () => {
    const layout = layoutPipeline(spec);
    const at = (id: string) => {
      const found = layout.nodes.find((n) => n.step.id === id);
      if (!found) throw new Error(`no node ${id}`);
      return found;
    };
    const middle = layout.width / 2;
    expect(at("read").x + NODE_WIDTH / 2).toBe(middle);
    expect(at("decide").x + NODE_WIDTH / 2).toBe(middle);
  });

  it("draws one edge per dependency", () => {
    const layout = layoutPipeline(spec);
    expect(layout.edges.map((e) => e.id).sort()).toEqual([
      "limits->decide",
      "read->limits",
      "read->rules",
      "rules->decide",
    ]);
  });

  it("measures the whole drawing", () => {
    const layout = layoutPipeline(spec);
    expect(layout.height).toBeGreaterThan(3 * NODE_HEIGHT);
    expect(layout.width).toBe(2 * NODE_WIDTH + GAP_X);
  });

  it("returns the reason, not an exception, for a graph that cannot be drawn", () => {
    const layout = layoutPipeline({
      steps: [step("a", ["b"]), step("b", ["a"])],
    });
    expect(layout.nodes).toEqual([]);
    expect(layout.problem).toMatch(/wait for each other/);
    expect(layoutPipeline({ steps: [step("a", ["ghost"])] }).problem).toMatch(
      /not a Step/,
    );
  });

  it("handles no Steps", () => {
    expect(layoutPipeline({ steps: [] })).toMatchObject({
      nodes: [],
      problem: null,
    });
  });
});

describe("specForRun", () => {
  it("chains the Steps of a Run whose Pipeline is not known", () => {
    const run = {
      steps: ["a", "b", "c"].map((stepId) => ({
        stepId,
        status: "pending" as const,
        startedAt: null,
        finishedAt: null,
        output: null,
        error: null,
        usage: null,
      })),
    };
    const spec = specForRun(null, run);
    expect(spec.steps.map((s) => s.after)).toEqual([[], ["a"], ["b"]]);
    expect(layoutPipeline(spec).parallelism).toBe(1);
  });
});

describe("fitGraph", () => {
  const span = (across: number, width = NODE_WIDTH) =>
    across * width + (across - 1) * GAP_X + 2 * GRAPH_PAD;

  it("shrinks a graph to its box, but not below a readable zoom", () => {
    const fit = fitGraph(span(4) * 0.9, 4);
    expect(fit).toMatchObject({ nodeWidth: NODE_WIDTH, pan: false });
    expect(fit.zoom).toBeCloseTo(0.9);
    expect(fitGraph(span(4) * 0.5, 4)).toEqual({
      nodeWidth: NODE_WIDTH,
      zoom: MIN_ZOOM,
      pan: true,
    });
  });

  it("widens the cards on a wide box instead of zooming the text", () => {
    const fit = fitGraph(span(4, 300), 4);
    expect(fit).toEqual({ nodeWidth: 300, zoom: MAX_ZOOM, pan: false });
    expect(fitGraph(5000, 4).nodeWidth).toBe(MAX_NODE_WIDTH);
  });

  it("lays the Steps out at the width it chose", () => {
    const layout = layoutPipeline(
      { steps: [step("a"), step("b"), step("c", ["a", "b"])] },
      300,
    );
    expect(layout.width).toBe(2 * 300 + GAP_X);
    expect(layout.bands[0]?.width).toBe(2 * 300 + GAP_X + 2 * BAND_PAD);
  });

  it("is the default before the box is measured", () => {
    expect(fitGraph(0, 3)).toEqual({
      nodeWidth: NODE_WIDTH,
      zoom: 1,
      pan: false,
    });
  });
});
