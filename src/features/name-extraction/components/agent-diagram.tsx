"use client";

import type { ToolkitNode } from "./run-view";
import { cx } from "./ui";

type NodeSpec = {
  x: number;
  y: number;
  title: string;
  sub: string;
  /** Drawn as a fan of cards: several run at once. */
  fan?: boolean;
  /** Outside the Run: how other clients reach the Analyst. */
  outside?: boolean;
};

export const NODE_SPECS: Record<ToolkitNode, NodeSpec> = {
  readers: {
    x: 120,
    y: 70,
    title: "Readers",
    sub: "spawn_readers · sub-agents",
    fan: true,
  },
  skills: { x: 380, y: 52, title: "Skills", sub: "load_skill · on demand" },
  sandbox: { x: 640, y: 70, title: "Sandbox", sub: "run_code · no network" },
  pages: { x: 110, y: 200, title: "Pages", sub: "read_pages · grep" },
  mcp: {
    x: 650,
    y: 200,
    title: "MCP endpoint",
    sub: "extract_names, get_run…",
    outside: true,
  },
  sweep: { x: 120, y: 330, title: "Sweep", sub: "outline · no model" },
  register: { x: 380, y: 348, title: "Register", sub: "record_names" },
  gate: { x: 640, y: 330, title: "Done gate", sub: "finish · checked" },
};

const W = 156;
const H = 50;
const CENTER = { x: 380, y: 200 };

/**
 * One Analyst in the middle, its toolkit around it. During a Run a node
 * lights while its tool is in flight or was the last one used, and shows
 * how many times it has been used.
 */
export function AgentDiagram({
  live,
  counts,
  running,
}: {
  live: Set<ToolkitNode>;
  counts: Partial<Record<ToolkitNode, number>>;
  /** A Run is in flight: the Analyst itself pulses. */
  running: boolean;
}) {
  const entries = Object.entries(NODE_SPECS) as [ToolkitNode, NodeSpec][];
  return (
    <svg
      viewBox="0 0 760 400"
      role="img"
      aria-label="The Analyst in the middle, with its tools around it: Readers, Skills, Sandbox, Pages, Sweep, Register, the Done gate, and the MCP endpoint outside clients call."
      className="h-auto w-full select-none"
    >
      <title>The Analyst and its toolkit</title>
      {entries.map(([id, node]) => {
        const lit = live.has(id);
        return (
          <line
            key={`edge-${id}`}
            x1={CENTER.x}
            y1={CENTER.y}
            x2={node.x}
            y2={node.y}
            className={cx(
              "transition-colors",
              lit ? "sv-flow stroke-federal-blue" : "stroke-ink/25",
            )}
            strokeWidth={lit ? 2.5 : 1.5}
            strokeDasharray={node.outside ? "5 5" : lit ? "8 6" : undefined}
          />
        );
      })}
      {entries.map(([id, node]) => {
        const lit = live.has(id);
        const count = counts[id];
        const x = node.x - W / 2;
        const y = node.y - H / 2;
        return (
          <g key={id} data-node={id} data-lit={lit || undefined}>
            {node.fan
              ? [8, 4].map((offset) => (
                  <rect
                    key={offset}
                    x={x + offset}
                    y={y - offset}
                    width={W}
                    height={H}
                    rx={2}
                    className={cx(
                      lit
                        ? "fill-morning-haze stroke-federal-blue"
                        : "fill-paper stroke-ink/30",
                    )}
                    strokeWidth={1}
                  />
                ))
              : null}
            <rect
              x={x}
              y={y}
              width={W}
              height={H}
              rx={2}
              className={cx(
                "transition-colors",
                lit
                  ? "sv-node-live fill-morning-haze stroke-federal-blue"
                  : node.outside
                    ? "fill-marble stroke-ink/40"
                    : "fill-paper stroke-ink/50",
              )}
              strokeWidth={lit ? 2 : 1.25}
              strokeDasharray={node.outside ? "4 3" : undefined}
            />
            <text
              x={x + 10}
              y={y + 21}
              className="fill-ink font-mono text-[13px] font-bold"
            >
              {node.title}
            </text>
            <text
              x={x + 10}
              y={y + 38}
              className="fill-ink-muted font-mono text-[10.5px]"
            >
              {node.sub}
            </text>
            {count ? (
              <g>
                <rect
                  x={x + W - 30}
                  y={y - 9}
                  width={30}
                  height={18}
                  rx={2}
                  className="fill-ink"
                />
                <text
                  x={x + W - 15}
                  y={y + 4}
                  textAnchor="middle"
                  className="fill-paper font-mono text-[11px] font-bold"
                >
                  ×{count}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
      <g>
        <rect
          x={CENTER.x - 92}
          y={CENTER.y - 38}
          width={184}
          height={76}
          rx={2}
          className={cx("fill-ink stroke-ink", running && "sv-analyst-live")}
        />
        <text
          x={CENTER.x}
          y={CENTER.y - 6}
          textAnchor="middle"
          className="fill-paper font-mono text-[17px] font-bold tracking-[0.08em]"
        >
          ANALYST
        </text>
        <text
          x={CENTER.x}
          y={CENTER.y + 16}
          textAnchor="middle"
          className="fill-brass font-mono text-[11px]"
        >
          one agent · picks its next tool
        </text>
      </g>
    </svg>
  );
}
