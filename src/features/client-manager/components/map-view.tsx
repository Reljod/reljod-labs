"use client";

import { useQueries } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { BuildState } from "../domain/build-state";
import { BRANCHES, type CategoryId } from "../domain/categories";
import {
  type DraftEdge,
  type DraftGraph,
  type DraftNode,
  edgeKey,
  type NodeType,
  ROOT_KEY,
} from "../domain/graph";
import { EMPTY_HIGHLIGHT, type Highlight } from "../domain/traversal";
import type { ClientSummary, NodeLite } from "../server/service";
import { fetchEdges, keys } from "./api";
import { CategoryTree } from "./category-tree";
import { CertaintyLine } from "./certainty";
import { FactSheet } from "./fact-sheet";
import { type CameraTarget, GraphCanvas } from "./graph-canvas";

const BRANCH_ORDER = new Map<string, number>(
  BRANCHES.map((branch, index) => [branch.id, index]),
);

function draftOf(node: NodeLite): DraftNode {
  return {
    key: node.key,
    label: node.label,
    type: node.type as NodeType,
    category: node.category as CategoryId,
    summary: node.summary,
    attributes: node.attributes,
    confidence: node.confidence,
    evidence: [],
  };
}

/**
 * Hands Nodes to the map a few per frame, Branch by Branch, so the first
 * frame is cheap and the network visibly grows. Positions depend only on
 * each Node's place within its leaf, which the order keeps, so nothing jumps.
 */
function useReveal<T extends { key: string; category: string }>(
  nodes: T[],
  instant: boolean,
) {
  const ordered = useMemo(
    () =>
      nodes
        .map((node, index) => ({ node, index }))
        .sort((a, b) => {
          if (a.node.key === ROOT_KEY) return -1;
          if (b.node.key === ROOT_KEY) return 1;
          const branch =
            (BRANCH_ORDER.get(a.node.category.split(".")[0] ?? "") ?? 9) -
            (BRANCH_ORDER.get(b.node.category.split(".")[0] ?? "") ?? 9);
          return branch || a.index - b.index;
        })
        .map(({ node }) => node),
    [nodes],
  );
  const [count, setCount] = useState(instant ? ordered.length : 1);
  useEffect(() => {
    if (instant || count >= ordered.length) return;
    const step = Math.max(1, Math.ceil(ordered.length / 55));
    const frame = requestAnimationFrame(() =>
      setCount((value) => Math.min(ordered.length, value + step)),
    );
    return () => cancelAnimationFrame(frame);
  }, [count, ordered.length, instant]);
  const shown = instant ? ordered : ordered.slice(0, count);
  return { shown, done: instant || count >= ordered.length };
}

export function MapView({
  client,
  live,
  focusKey,
  highlight = EMPTY_HIGHLIGHT,
  onFocus,
  onOpenSource,
}: {
  client: ClientSummary;
  /** The Build running now, drawn as it streams in. */
  live: BuildState | null;
  focusKey: string | null;
  highlight?: Highlight;
  onFocus: (key: string | null) => void;
  onOpenSource: (sourceId: string, quote?: string) => void;
}) {
  const building = !!live && !live.end;
  const [target, setTarget] = useState<CameraTarget>(
    focusKey ? { kind: "node", key: focusKey } : { kind: "overview" },
  );
  useEffect(() => {
    if (focusKey) setTarget({ kind: "node", key: focusKey });
  }, [focusKey]);

  const baseNodes = useMemo(
    () => (building && live ? live.graph.nodes : client.nodes.map(draftOf)),
    [building, live, client.nodes],
  );
  const { shown, done } = useReveal(baseNodes, building);

  // Relations load by the part of the map you are looking at.
  const [scopes, setScopes] = useState<string[]>([]);
  const wanted =
    target.kind === "branch"
      ? `branch:${target.id}`
      : target.kind === "leaf"
        ? `leaf:${target.id}`
        : target.kind === "node"
          ? `node:${target.key}`
          : "root";
  useEffect(() => {
    if (!done || building) return;
    // The client's own relations first, then whatever is opened.
    setScopes((list) => {
      const next = new Set([...list, "root", wanted]);
      return next.size === list.length ? list : [...next];
    });
  }, [wanted, done, building]);
  const { edges: loaded, loadingEdges } = useQueries({
    queries: scopes.map((scope) => ({
      queryKey: keys.edges(client.id, scope),
      queryFn: () => fetchEdges(client.id, scope),
      staleTime: 60_000,
    })),
    combine: (results) => {
      const map = new Map<string, DraftEdge>();
      for (const result of results) {
        for (const edge of result.data ?? []) {
          const draft: DraftEdge = {
            from: edge.from,
            to: edge.to,
            relation: edge.relation,
            label: edge.label,
            confidence: edge.confidence,
            evidence: [],
          };
          map.set(edgeKey(draft), draft);
        }
      }
      return {
        edges: [...map.values()],
        loadingEdges: results.some((result) => result.isFetching),
      };
    },
  });

  const graph: DraftGraph = useMemo(() => {
    const present = new Set(shown.map((node) => node.key));
    const edges = (building && live ? live.graph.edges : loaded).filter(
      (edge) => present.has(edge.from) && present.has(edge.to),
    );
    return { nodes: shown, edges };
  }, [shown, loaded, building, live]);

  const select = (key: string | null) => {
    onFocus(key);
    if (key) setTarget({ kind: "node", key });
  };

  return (
    <div className="grid h-full min-h-0 md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="cm-scroll hidden min-h-0 overflow-y-auto border-ink/10 border-r p-2 md:block">
        <CategoryTree
          graph={graph}
          target={target}
          highlight={highlight}
          onTarget={(next) => {
            onFocus(null);
            setTarget(next);
          }}
          onSelect={(key) => select(key)}
        />
      </aside>
      <div className="relative min-h-[24rem]">
        <GraphCanvas
          graph={graph}
          clientName={client.name}
          portraitUrl={client.portraitUrl}
          highlight={highlight}
          target={target}
          selected={focusKey}
          building={building}
          revealing={!done}
          arrivals={building ? live?.arrivals : undefined}
          departures={live?.departures}
          onTarget={(next) => {
            onFocus(null);
            setTarget(next);
          }}
          onSelect={select}
        />
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-sm bg-paper/85 px-2.5 py-1.5 text-[0.65rem] text-ink-muted shadow-hard-sm backdrop-blur">
          {[0.9, 0.7, 0.45].map((confidence, index) => (
            <span key={confidence} className="flex items-center gap-1">
              <CertaintyLine confidence={confidence} className="h-2 w-5" />
              {["Stated", "Likely", "Unsure"][index]}
            </span>
          ))}
          {loadingEdges ? (
            <span
              title="Loading relations"
              className="cm-pulse size-1.5 rounded-full bg-brass"
            />
          ) : null}
        </div>
        <AnimatePresence>
          {focusKey ? (
            <div className="absolute top-3 right-3 bottom-3 z-10 w-[min(22rem,calc(100%-1.5rem))]">
              <FactSheet
                clientId={client.id}
                clientName={client.name}
                nodeKey={focusKey}
                nodes={client.nodes}
                sources={client.sources}
                onSelect={select}
                onOpenSource={onOpenSource}
                onClose={() => onFocus(null)}
              />
            </div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
