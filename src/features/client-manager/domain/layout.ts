import { BRANCHES, branchOf, type CategoryId } from "./categories";
import { ROOT_KEY } from "./graph";

/**
 * Where everything sits on the Graph view, in world units with the client at
 * the origin. Every Branch and leaf Category has a fixed slot, and Nodes
 * spiral out from their leaf in arrival order (a sunflower), so adding a Node
 * never moves the ones already drawn.
 */

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export const BRANCH_RADIUS = 470;
export const LEAF_DISTANCE = 185;
const LEAF_FAN = (130 * Math.PI) / 180;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export type BranchSlot = Point & { id: string; angle: number };
export type LeafSlot = Point & {
  id: CategoryId;
  branchId: string;
  angle: number;
};

export type Layout = {
  branches: BranchSlot[];
  leaves: LeafSlot[];
  nodes: Map<string, Point & { category: string }>;
};

const polar = (
  radius: number,
  angle: number,
  origin: Point = { x: 0, y: 0 },
) => ({
  x: origin.x + radius * Math.cos(angle),
  y: origin.y + radius * Math.sin(angle),
});

function slots() {
  const branches: BranchSlot[] = [];
  const leaves: LeafSlot[] = [];
  BRANCHES.forEach((branch, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / BRANCHES.length;
    const hub = polar(BRANCH_RADIUS, angle);
    branches.push({ id: branch.id, angle, ...hub });
    const count: number = branch.leaves.length;
    branch.leaves.forEach((leaf, leafIndex) => {
      const offset =
        count === 1 ? 0 : (leafIndex / (count - 1) - 0.5) * LEAF_FAN;
      const leafAngle = angle + offset;
      leaves.push({
        id: `${branch.id}.${leaf.id}` as CategoryId,
        branchId: branch.id,
        angle: leafAngle,
        ...polar(LEAF_DISTANCE, leafAngle, hub),
      });
    });
  });
  return { branches, leaves };
}

const SLOTS = slots();

/** The k-th Node around a leaf: a sunflower spiral leaning outward. */
export function spiral(leaf: LeafSlot, index: number): Point {
  const radius = 34 + 19 * Math.sqrt(index);
  return polar(radius, leaf.angle + index * GOLDEN_ANGLE, leaf);
}

export function layoutGraph(
  nodes: { key: string; category: string }[],
): Layout {
  const leafById = new Map(SLOTS.leaves.map((leaf) => [leaf.id, leaf]));
  const counts = new Map<string, number>();
  const placed = new Map<string, Point & { category: string }>();
  for (const node of nodes) {
    if (node.key === ROOT_KEY) {
      placed.set(node.key, { x: 0, y: 0, category: node.category });
      continue;
    }
    const leaf = leafById.get(node.category as CategoryId) ?? SLOTS.leaves[0];
    if (!leaf) continue;
    const index = counts.get(leaf.id) ?? 0;
    counts.set(leaf.id, index + 1);
    placed.set(node.key, { ...spiral(leaf, index), category: node.category });
  }
  return { branches: SLOTS.branches, leaves: SLOTS.leaves, nodes: placed };
}

export function boxAround(points: Point[], pad: number): Box {
  if (points.length === 0)
    return { x: -pad, y: -pad, width: pad * 2, height: pad * 2 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) + pad - minX,
    height: Math.max(...ys) + pad - minY,
  };
}

/** The whole network, with room for the Branch labels. */
export function overviewBox(): Box {
  return boxAround([...SLOTS.branches, ...SLOTS.leaves], 170);
}

/** One Branch, its leaves and every Node they hold. */
export function branchBox(layout: Layout, branchId: string): Box {
  const hub = layout.branches.find((branch) => branch.id === branchId);
  const leaves = layout.leaves.filter((leaf) => leaf.branchId === branchId);
  const members = [...layout.nodes.values()].filter(
    (node) => branchOf(node.category) === branchId,
  );
  return boxAround([...(hub ? [hub] : []), ...leaves, ...members], 90);
}

export function leafBox(layout: Layout, category: string): Box {
  const leaf = layout.leaves.find((item) => item.id === category);
  const members = [...layout.nodes.values()].filter(
    (node) => node.category === category,
  );
  return boxAround([...(leaf ? [leaf] : []), ...members], 80);
}

export function pointBox(points: Point[], pad = 120): Box {
  return boxAround(points, pad);
}

/** Grows a box to the viewport's aspect ratio, keeping its centre. */
export function fitAspect(box: Box, aspect: number): Box {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  let { width, height } = box;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}
