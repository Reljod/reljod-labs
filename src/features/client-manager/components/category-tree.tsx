"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import { BRANCHES, TONE_HEX } from "../domain/categories";
import { type DraftGraph, ROOT_KEY } from "../domain/graph";
import type { Highlight } from "../domain/traversal";
import type { CameraTarget } from "./graph-canvas";

/**
 * The Category tree as a list: the way in for keyboards and small screens,
 * and a legend that shows where the Navigator is walking.
 */
export function CategoryTree({
  graph,
  target,
  highlight,
  onTarget,
  onSelect,
}: {
  graph: DraftGraph;
  target: CameraTarget;
  highlight: Highlight;
  onTarget: (target: CameraTarget) => void;
  onSelect: (key: string) => void;
}) {
  const byLeaf = useMemo(() => {
    const map = new Map<string, DraftGraph["nodes"]>();
    for (const node of graph.nodes) {
      if (node.key === ROOT_KEY) continue;
      const list =
        map.get(node.category) ?? map.set(node.category, []).get(node.category);
      list?.push(node);
    }
    return map;
  }, [graph.nodes]);
  const openBranch =
    target.kind === "branch"
      ? target.id
      : target.kind === "leaf"
        ? target.id.split(".")[0]
        : null;
  const openLeaf = target.kind === "leaf" ? target.id : null;

  return (
    <nav aria-label="Categories" className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => onTarget({ kind: "overview" })}
        className={`eyebrow flex items-center justify-between rounded-sm px-2 py-1.5 text-left font-bold ${target.kind === "overview" ? "bg-ink text-paper" : "hover:bg-limestone"}`}
      >
        Whole network
        <span>{graph.nodes.length}</span>
      </button>
      {BRANCHES.map((branch) => {
        const tone = TONE_HEX[branch.tone];
        const leaves = branch.leaves.map((leaf) => ({
          ...leaf,
          id: `${branch.id}.${leaf.id}`,
          nodes: byLeaf.get(`${branch.id}.${leaf.id}`) ?? [],
        }));
        const total = leaves.reduce((sum, leaf) => sum + leaf.nodes.length, 0);
        const open = openBranch === branch.id;
        const walking = leaves.some((leaf) =>
          leaf.nodes.some((node) => highlight.nodes.has(node.key)),
        );
        return (
          <div key={branch.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() =>
                onTarget(
                  open
                    ? { kind: "overview" }
                    : { kind: "branch", id: branch.id },
                )
              }
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-semibold transition-colors ${open ? "bg-paper outline-box" : "hover:bg-limestone"} ${total === 0 ? "opacity-50" : ""}`}
            >
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border-2 border-ink"
                style={{ background: tone }}
              />
              <span className="min-w-0 flex-1 truncate">{branch.label}</span>
              {walking ? (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-brass motion-safe:animate-live-pulse"
                />
              ) : null}
              <span className="font-mono text-xs text-ink-muted">{total}</span>
            </button>
            {open ? (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                className="ml-3 overflow-hidden border-l-2 pl-2"
                style={{ borderColor: tone }}
              >
                {leaves.map((leaf) => (
                  <li key={leaf.id}>
                    <button
                      type="button"
                      onClick={() => onTarget({ kind: "leaf", id: leaf.id })}
                      className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-sm ${openLeaf === leaf.id ? "bg-morning-haze font-semibold" : "hover:bg-limestone"} ${leaf.nodes.length === 0 ? "text-stone" : ""}`}
                    >
                      {leaf.label}
                      <span className="font-mono text-xs">
                        {leaf.nodes.length}
                      </span>
                    </button>
                    {openLeaf === leaf.id && leaf.nodes.length > 0 ? (
                      <ul className="mb-1 ml-2">
                        {leaf.nodes.map((node) => (
                          <li key={node.key}>
                            <button
                              type="button"
                              onClick={() => onSelect(node.key)}
                              className={`w-full truncate rounded-sm px-2 py-0.5 text-left text-xs hover:bg-limestone ${highlight.nodes.has(node.key) ? "font-bold text-federal-blue" : "text-ink-muted"}`}
                            >
                              {node.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
