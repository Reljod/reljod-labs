"use client";

import { useEffect, useRef } from "react";
import { type StopReason, TOOLS } from "../domain/contract";
import { SKILLS } from "../skills";
import { duration } from "./format";
import type { CodeCell, RunView, TimelineItem } from "./run-view";
import { cx, Panel, Spinner, Tag } from "./ui";

const STATUS_TONE = {
  queued: "neutral",
  running: "blue",
  completed: "green",
  failed: "red",
  stopped: "brass",
} as const;

const STOPPED_BY_LABEL: Record<StopReason, string> = {
  turns: "turn limit",
  cost: "spend limit",
  idle: "idle",
};

const STATUS_WORD = {
  queued: "queued",
  running: "running",
  completed: "finished",
  failed: "failed",
  stopped: "stopped",
} as const;

/** A Run's status; a completed Run a cap ended says so instead of "completed". */
export function StatusTag({
  status,
  stoppedBy = null,
}: {
  status: RunView["status"];
  stoppedBy?: StopReason | null;
}) {
  const capped = status === "completed" && stoppedBy !== null;
  return (
    <Tag tone={capped ? STATUS_TONE.stopped : STATUS_TONE[status]}>
      {status === "running" ? <Spinner className="size-2.5" /> : null}
      {capped ? `ended at ${STOPPED_BY_LABEL[stoppedBy]}` : STATUS_WORD[status]}
    </Tag>
  );
}

function CodeBlock({ cell }: { cell: CodeCell }) {
  return (
    <div className="flex flex-col gap-1">
      <pre className="sv-scroll max-h-72 overflow-auto rounded-sm bg-ink p-3 font-mono text-[0.72rem] leading-relaxed text-paper">
        {cell.code}
      </pre>
      <div className="flex flex-wrap gap-2 font-mono text-[0.68rem] text-ink-muted">
        <Tag tone={cell.exitCode === 0 ? "green" : "red"}>
          exit {cell.exitCode}
        </Tag>
        <span>{duration(cell.ms)}</span>
      </div>
      {cell.stdout ? (
        <pre className="sv-scroll max-h-56 overflow-auto rounded-sm border border-ink/15 bg-marble/50 p-2 font-mono text-[0.7rem] whitespace-pre-wrap">
          {cell.stdout}
        </pre>
      ) : null}
      {cell.stderr ? (
        <pre className="sv-scroll max-h-40 overflow-auto rounded-sm border border-seal-red/30 bg-seal-red/5 p-2 font-mono text-[0.7rem] whitespace-pre-wrap text-seal-red">
          {cell.stderr}
        </pre>
      ) : null}
    </div>
  );
}

function json(value: unknown) {
  if (value === undefined) return "";
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "thought")
    return (
      <p className="text-sm leading-relaxed text-ink-muted italic">
        {item.text}
      </p>
    );
  if (item.kind === "skill")
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Tag tone="blue">load_skill</Tag>
        <span className="font-semibold">
          {SKILLS[item.skill]?.title ?? item.skill}
        </span>
        <span className="font-mono text-xs text-ink-muted">
          {item.skill}/SKILL.md
        </span>
      </p>
    );
  if (item.kind === "log")
    return (
      <p
        className={cx(
          "font-mono text-xs",
          item.level === "error" && "text-seal-red",
          item.level === "warn" && "text-oak",
          item.level === "info" && "text-ink-muted",
        )}
      >
        {item.text}
      </p>
    );
  const refused = item.tool === "finish" && item.state === "error";
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className="font-mono text-xs group-open:rotate-90"
        >
          ▸
        </span>
        <Tag
          tone={
            item.state === "error"
              ? "red"
              : item.state === "start"
                ? "blue"
                : "ink"
          }
        >
          {TOOLS[item.tool]?.label ?? item.tool}
        </Tag>
        <span className="min-w-0 flex-1 truncate">
          {item.summary || TOOLS[item.tool]?.hint}
        </span>
        {item.state === "start" ? (
          <Spinner className="text-federal-blue" />
        ) : null}
        {refused ? <Tag tone="brass">gate refused</Tag> : null}
        {item.ms !== undefined ? (
          <span className="font-mono text-[0.68rem] text-ink-muted">
            {duration(item.ms)}
          </span>
        ) : null}
      </summary>
      <div className="mt-2 flex flex-col gap-2 pl-5">
        {item.code ? <CodeBlock cell={item.code} /> : null}
        {item.input !== undefined && !item.code ? (
          <div>
            <p className="eyebrow mb-1 text-[0.6rem] text-ink-muted">Input</p>
            <pre className="sv-scroll max-h-56 overflow-auto rounded-sm border border-ink/15 bg-marble/50 p-2 font-mono text-[0.7rem] whitespace-pre-wrap">
              {json(item.input)}
            </pre>
          </div>
        ) : null}
        {item.output ? (
          <div>
            <p className="eyebrow mb-1 text-[0.6rem] text-ink-muted">Output</p>
            <pre className="sv-scroll max-h-56 overflow-auto rounded-sm border border-ink/15 bg-paper p-2 font-mono text-[0.7rem] whitespace-pre-wrap">
              {item.output}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function itemKey(item: TimelineItem) {
  return item.kind === "tool" ? `t-${item.callId}` : `${item.kind}-${item.seq}`;
}

/** What the Analyst thought and did, in order. Follows the tail while live unless scrolled up. */
export function Timeline({
  items,
  live,
}: {
  items: TimelineItem[];
  live: boolean;
}) {
  const body = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail as items arrive
  useEffect(() => {
    const element = body.current;
    if (element && live && pinned.current)
      element.scrollTo({ top: element.scrollHeight });
  }, [items.length, live]);

  return (
    <Panel
      eyebrow="Every step, as the agent took it"
      title={`${items.length} steps`}
      bodyClassName=""
    >
      <ol
        ref={body}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            40;
        }}
        className="sv-scroll flex max-h-[34rem] flex-col overflow-y-auto"
      >
        {items.length === 0 ? (
          <li className="px-4 py-3 text-sm text-ink-muted">
            {live
              ? "Waiting for the lead agent…"
              : "Nothing happened in this run."}
          </li>
        ) : null}
        {items.map((item) => (
          <li
            key={itemKey(item)}
            className="sv-reveal border-ink/10 border-b px-4 py-2 last:border-b-0"
          >
            <TimelineRow item={item} />
          </li>
        ))}
      </ol>
    </Panel>
  );
}
