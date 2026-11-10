"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";

export type TerminalLine = {
  at: number;
  level: "info" | "warn" | "error" | "mcp" | "cost";
  text: string;
};

const TONE = {
  info: "text-paper/80",
  warn: "text-brass",
  error: "text-[#ff8b7b]",
  mcp: "text-clear-sky",
  cost: "text-[#9fd3a8]",
} as const;

/** The run log, MCP calls and spend, folded away until asked for. */
export function Terminal({
  lines,
  open,
  onToggle,
  costUsd,
}: {
  lines: TerminalLine[];
  open: boolean;
  onToggle: () => void;
  costUsd: number;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const last = lines.at(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [lines.length, open]);

  return (
    <div className="pointer-events-auto border-ink border-t-2 bg-ink text-paper">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-3 px-4 text-left font-mono text-xs"
      >
        <span className="font-bold tracking-[0.12em] text-brass uppercase">
          {open ? "▾" : "▸"} Terminal
        </span>
        {!open && last ? (
          <span className={`truncate ${TONE[last.level]}`}>{last.text}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-paper/60">
          {lines.length} lines · ${costUsd.toFixed(4)}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 220 }}
            exit={{ height: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div
              ref={bodyRef}
              className="cw-scroll h-[220px] overflow-y-auto px-4 pb-3 font-mono text-[11.5px] leading-[1.55]"
            >
              {lines.length === 0 ? (
                <p className="text-paper/50">$ waiting for work</p>
              ) : null}
              {lines.map((line, index) => (
                <p
                  // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
                  key={index}
                  className={`whitespace-pre-wrap ${TONE[line.level]}`}
                >
                  <span className="text-paper/35">
                    {new Date(line.at).toLocaleTimeString("en-GB", {
                      hour12: false,
                    })}{" "}
                  </span>
                  {line.text}
                </p>
              ))}
              <p className="text-paper/60">
                $ <span className="cw-caret">▍</span>
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
