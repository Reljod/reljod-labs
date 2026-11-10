import type { TraversalStep } from "./events";
import { ROOT_KEY } from "./graph";

/**
 * What the Graph view lights up while the Navigator walks: every Node and
 * Edge it touched, the order it touched them in (the view staggers by it),
 * and how. Later steps keep what earlier ones lit.
 */

export type Glow = "seed" | "reach" | "path" | "read" | "category";

export type Highlight = {
  nodes: Map<string, { glow: Glow; order: number; depth: number }>;
  edges: Map<string, { glow: Glow; order: number }>;
  /** The Nodes the last step was about: where the camera goes. */
  focus: string[];
};

export const EMPTY_HIGHLIGHT: Highlight = {
  nodes: new Map(),
  edges: new Map(),
  focus: [],
};

const RANK: Record<Glow, number> = {
  category: 0,
  reach: 1,
  seed: 2,
  read: 3,
  path: 4,
};

export function highlightFrom(steps: TraversalStep[]): Highlight {
  const nodes: Highlight["nodes"] = new Map();
  const edges: Highlight["edges"] = new Map();
  let order = 0;
  let focus: string[] = [];

  const light = (key: string, glow: Glow, depth = 0) => {
    const current = nodes.get(key);
    if (!current) {
      nodes.set(key, { glow, order: order++, depth });
    } else if (RANK[glow] > RANK[current.glow]) {
      nodes.set(key, { ...current, glow });
    }
  };
  const trace = (key: string, glow: Glow) => {
    const current = edges.get(key);
    if (!current || RANK[glow] > RANK[current.glow]) {
      edges.set(key, { glow, order: current?.order ?? order++ });
    }
  };

  for (const step of steps) {
    switch (step.kind) {
      case "search":
        for (const hit of step.hits) light(hit.key, "seed");
        focus = step.hits.map((hit) => hit.key);
        break;
      case "category":
        for (const key of step.keys) light(key, "category");
        focus = step.keys;
        break;
      case "expand": {
        const sorted = [...step.reached].sort((a, b) => a.depth - b.depth);
        for (const node of sorted) {
          if (node.via) trace(node.via, "reach");
          light(node.key, node.depth === 0 ? "seed" : "reach", node.depth);
        }
        focus = sorted.map((node) => node.key);
        break;
      }
      case "path":
        step.nodes.forEach((key, index) => {
          light(key, "path", index);
          const edge = step.edges[index];
          if (edge) trace(edge, "path");
        });
        focus = step.nodes;
        break;
      case "read":
        for (const key of step.keys) light(key, "read");
        focus = step.keys;
        break;
    }
  }
  return { nodes, edges, focus: focus.length > 0 ? focus : [ROOT_KEY] };
}

/** One line per step for the trace in the chat. */
export function describeStep(
  step: TraversalStep,
  labelOf: (key: string) => string,
): { title: string; detail: string } {
  switch (step.kind) {
    case "search":
      return {
        title: `Searched “${step.query}”`,
        detail:
          step.hits.length === 0
            ? "nothing matched"
            : `${step.hits.length} seeds · ${step.hits
                .slice(0, 3)
                .map((hit) => labelOf(hit.key))
                .join(", ")}`,
      };
    case "expand":
      return {
        title: `Walked ${step.hops} hop${step.hops === 1 ? "" : "s"} from ${step.from.length === 1 ? labelOf(step.from[0] ?? "") : `${step.from.length} Nodes`}`,
        detail: `reached ${step.reached.length} Nodes`,
      };
    case "path":
      return {
        title: `Connected ${labelOf(step.from)} → ${labelOf(step.to)}`,
        detail:
          step.nodes.length === 0
            ? "no path"
            : `${Math.max(0, step.nodes.length - 1)} hops via ${step.nodes.slice(1, -1).map(labelOf).join(", ") || "a direct link"}`,
      };
    case "category":
      return {
        title: `Opened ${step.category}`,
        detail: `${step.keys.length} Nodes`,
      };
    case "read":
      return {
        title: `Read ${step.keys.length} Node${step.keys.length === 1 ? "" : "s"}`,
        detail: step.keys.slice(0, 4).map(labelOf).join(", "),
      };
  }
}
