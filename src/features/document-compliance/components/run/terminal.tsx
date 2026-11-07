"use client";

import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { LogLine, LogTone } from "../../scan-state";

const TONE: Record<LogTone, string> = {
  muted: "text-stone",
  info: "text-clear-sky",
  ok: "text-[#7fc48f]",
  warn: "text-brass",
  bad: "text-[#ef7d6d]",
};

const stamp = (ms: number) => `+${(ms / 1000).toFixed(1).padStart(5, "0")}s`;

type TerminalProps = {
  title: string;
  lines: LogLine[];
  live: boolean;
  reduceMotion: boolean;
};

/** What the run is doing, line by line, as it happens. */
export function Terminal({ title, lines, live, reduceMotion }: TerminalProps) {
  const body = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDetailsElement>(null);

  // On phones the terminal starts as a closed drawer under the scan.
  useEffect(() => {
    if (drawer.current) {
      drawer.current.open = window.matchMedia("(min-width: 640px)").matches;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow each new line
  useEffect(() => {
    const element = body.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines.length]);

  return (
    <details
      ref={drawer}
      open
      className="group outline-box overflow-hidden rounded-sm bg-ink text-paper shadow-hard-md"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 border-paper/20 border-b px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-seal-red" />
          <span className="size-2.5 rounded-full bg-brass" />
          <span className="size-2.5 rounded-full bg-ivy" />
        </span>
        <span className="flex-1 truncate font-mono text-xs text-stone">
          {title}
        </span>
        {live ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-brass uppercase tracking-[0.1em]">
            <span className="size-1.5 animate-pulse rounded-full bg-brass" />
            live
          </span>
        ) : null}
        <span
          aria-hidden
          className="font-mono text-stone text-xs transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div
        ref={body}
        data-testid="terminal"
        role="log"
        aria-live="off"
        className="h-56 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed sm:h-64"
      >
        {lines.map((line) => (
          <motion.div
            key={line.id}
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
            className="flex gap-3 whitespace-pre-wrap break-all"
          >
            <span className="shrink-0 text-stone/70">{stamp(line.at)}</span>
            <span className={TONE[line.tone]}>{line.text}</span>
          </motion.div>
        ))}
        {live ? (
          <span className="inline-block h-3.5 w-2 animate-pulse bg-paper align-middle" />
        ) : null}
      </div>
    </details>
  );
}
