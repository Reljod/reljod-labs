"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { BRANCHES, TONE_HEX } from "../domain/categories";
import { type DraftGraph, ROOT_KEY } from "../domain/graph";
import type { Highlight } from "../domain/traversal";
import type { CameraTarget } from "./graph-canvas";

const add = (set: Set<string>, id: string) =>
  set.has(id) ? set : new Set([...set, id]);

const toggle = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/**
 * The Category tree as a list: the way in for keyboards and small screens,
 * and a legend that shows where a walk lit the map. Which Branches and
 * leaves are open is the tree's own state: opening a Node keeps them open,
 * and only the chevrons fold them.
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
  const [openBranches, setOpenBranches] = useState<Set<string>>(new Set());
  const [openLeaves, setOpenLeaves] = useState<Set<string>>(new Set());

  // Wherever the map goes, the tree opens the way there and keeps it open.
  const where =
    target.kind === "branch" || target.kind === "leaf"
      ? target.id
      : target.kind === "node"
        ? (graph.nodes.find((node) => node.key === target.key)?.category ?? "")
        : "";
  useEffect(() => {
    if (!where) return;
    const [branchId, leafId] = where.split(".");
    if (branchId) setOpenBranches((set) => add(set, branchId));
    if (leafId) setOpenLeaves((set) => add(set, where));
  }, [where]);

  const activeLeaf = target.kind === "leaf" ? target.id : null;
  const activeBranch = target.kind === "branch" ? target.id : null;
  const selectedKey = target.kind === "node" ? target.key : null;

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
        const open = openBranches.has(branch.id);
        const walking = leaves.some((leaf) =>
          leaf.nodes.some((node) => highlight.nodes.has(node.key)),
        );
        return (
          <div key={branch.id}>
            <div className="flex items-center">
              <button
                type="button"
                aria-label={`${open ? "Fold" : "Unfold"} ${branch.label}`}
                aria-expanded={open}
                onClick={() => setOpenBranches((set) => toggle(set, branch.id))}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-limestone"
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
                  aria-hidden="true"
                >
                  <path
                    d="M9 6l6 6-6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenBranches((set) => add(set, branch.id));
                  onTarget({ kind: "branch", id: branch.id });
                }}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1.5 text-left text-sm font-semibold transition-colors ${activeBranch === branch.id ? "bg-paper outline-box" : "hover:bg-limestone"} ${total === 0 ? "opacity-50" : ""}`}
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
                <span className="font-mono text-xs text-ink-muted">
                  {total}
                </span>
              </button>
            </div>
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
                      aria-expanded={openLeaves.has(leaf.id)}
                      onClick={() => {
                        setOpenLeaves((set) =>
                          activeLeaf === leaf.id
                            ? toggle(set, leaf.id)
                            : add(set, leaf.id),
                        );
                        onTarget({ kind: "leaf", id: leaf.id });
                      }}
                      className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-sm ${activeLeaf === leaf.id ? "bg-morning-haze font-semibold" : "hover:bg-limestone"} ${leaf.nodes.length === 0 ? "text-stone" : ""}`}
                    >
                      {leaf.label}
                      <span className="font-mono text-xs">
                        {leaf.nodes.length}
                      </span>
                    </button>
                    {openLeaves.has(leaf.id) && leaf.nodes.length > 0 ? (
                      <ul className="mb-1 ml-2">
                        {leaf.nodes.map((node) => (
                          <li key={node.key}>
                            <button
                              type="button"
                              onClick={() => onSelect(node.key)}
                              aria-current={selectedKey === node.key}
                              className={`w-full truncate rounded-sm px-2 py-0.5 text-left text-xs hover:bg-limestone ${selectedKey === node.key ? "bg-ink font-semibold text-paper hover:bg-ink" : highlight.nodes.has(node.key) ? "font-bold text-federal-blue" : "text-ink-muted"}`}
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
