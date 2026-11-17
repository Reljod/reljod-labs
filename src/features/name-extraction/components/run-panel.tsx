"use client";

import { useEffect, useRef, useState } from "react";
import { PURPOSES, type Purpose, TOOLS } from "../domain/contract";
import { SKILLS } from "../skills";
import { duration, modelLabel, tokens, usd } from "./format";
import {
  type CodeCell,
  type CostLine,
  isOver,
  type ReaderView,
  type RunView,
  type TimelineItem,
} from "./run-view";
import { Button, cx, ErrorNote, Panel, Spinner, Tag, useNow } from "./ui";

const STATUS_TONE = {
  queued: "neutral",
  running: "blue",
  completed: "green",
  failed: "red",
  stopped: "brass",
} as const;

export function StatusTag({ status }: { status: RunView["status"] }) {
  return (
    <Tag tone={STATUS_TONE[status]}>
      {status === "running" ? <Spinner className="size-2.5" /> : null}
      {status}
    </Tag>
  );
}

/** The open Run, live: header with Stop, Done gate, cost, Readers and the timeline. */
export function RunPanel({
  view,
  onStop,
}: {
  view: RunView;
  /** Resolves to an error message, or null. */
  onStop: () => Promise<string | null>;
}) {
  const live = !isOver(view.status);
  const now = useNow(live && view.startedAt !== null);
  const elapsed =
    view.startedAt === null ? 0 : (view.endedAt ?? now) - view.startedAt;
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);

  // Stop is the escape hatch: guarded against a double click, never asks first.
  const stop = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    setStopError(null);
    try {
      const problem = await onStop();
      if (problem) setStopError(problem);
    } catch (error) {
      setStopError(error instanceof Error ? error.message : "Could not stop.");
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="Run"
        title={view.document?.title ?? "Starting…"}
        actions={
          <>
            <StatusTag status={view.status} />
            <span className="font-mono text-xs text-ink-muted tabular-nums">
              {duration(Math.max(0, elapsed))}
            </span>
            {live ? (
              <Button
                variant="danger"
                size="sm"
                pending={stopping}
                pendingLabel="Stopping…"
                onClick={() => void stop()}
              >
                Stop
              </Button>
            ) : null}
          </>
        }
        bodyClassName="grid gap-4 p-4 md:grid-cols-2"
      >
        <GateMeter view={view} />
        <CostMeter view={view} />
        {stopError ? (
          <div className="md:col-span-2">
            <ErrorNote>{stopError}</ErrorNote>
          </div>
        ) : null}
        {view.error ? (
          <div className="md:col-span-2">
            <ErrorNote>Run failed: {view.error}</ErrorNote>
          </div>
        ) : null}
      </Panel>
      {view.readers.length > 0 ? <ReaderGrid readers={view.readers} /> : null}
      <Timeline items={view.timeline} live={live} />
    </div>
  );
}

function GateMeter({ view }: { view: RunView }) {
  const gate = view.gate;
  const total = gate?.pagesTotal ?? view.document?.pages ?? 0;
  const read = gate?.pagesRead ?? 0;
  const share = total > 0 ? Math.min(1, read / total) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="eyebrow text-[0.65rem] text-ink-muted">Done gate</h3>
        {gate ? (
          <Tag tone={gate.passed ? "green" : "neutral"}>
            {gate.passed ? "passed" : "not yet"}
          </Tag>
        ) : null}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a styled bar; a native <meter> cannot take the site's colours across browsers */}
      <div
        role="meter"
        aria-label="Pages read"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={read}
        className="h-3 overflow-hidden rounded-sm border border-ink/20 bg-marble"
      >
        <div
          className={cx(
            "h-full transition-[width] duration-500",
            gate?.passed ? "bg-ivy" : "bg-federal-blue",
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="font-mono text-xs tabular-nums">
        {read} / {total} pages read ·{" "}
        <span className={gate && gate.candidatesOpen > 0 ? "text-oak" : ""}>
          {gate?.candidatesOpen ?? "–"} candidates open
        </span>
      </p>
      <p className="text-xs text-ink-muted">
        <code className="font-mono">finish</code> is refused until every page is
        read and every Sweep candidate is recorded or dismissed.
      </p>
    </div>
  );
}

function costRow(label: string, line: CostLine, title?: string) {
  return (
    <tr key={label} className="border-ink/10 border-t" title={title}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 pr-2 text-right tabular-nums">{line.calls}</td>
      <td className="py-1 pr-2 text-right tabular-nums">
        {tokens(line.inputTokens)}
        {line.cachedInputTokens > 0 ? (
          <span className="text-ink-muted">
            {" "}
            ({tokens(line.cachedInputTokens)} cached)
          </span>
        ) : null}
      </td>
      <td className="py-1 pr-2 text-right tabular-nums">
        {tokens(line.outputTokens)}
      </td>
      <td className="py-1 text-right tabular-nums">{usd(line.costUsd)}</td>
    </tr>
  );
}

function CostMeter({ view }: { view: RunView }) {
  const { total, byPurpose, byModel } = view.cost;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="eyebrow text-[0.65rem] text-ink-muted">Cost</h3>
        <span className="font-mono text-lg font-bold tabular-nums">
          {usd(total.costUsd)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[0.7rem]">
          <thead className="text-ink-muted">
            <tr>
              <th className="pr-2 text-left font-normal">by</th>
              <th className="pr-2 text-right font-normal">calls</th>
              <th className="pr-2 text-right font-normal">in</th>
              <th className="pr-2 text-right font-normal">out</th>
              <th className="text-right font-normal">USD</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(PURPOSES) as Purpose[]).flatMap((purpose) => {
              const line = byPurpose[purpose];
              return line ? [costRow(PURPOSES[purpose].label, line)] : [];
            })}
            {Object.entries(byModel).map(([model, line]) =>
              costRow(modelLabel(model), line, model),
            )}
          </tbody>
        </table>
      </div>
      {total.calls === 0 ? (
        <p className="text-xs text-ink-muted">No model calls yet.</p>
      ) : null}
    </div>
  );
}

function ReaderGrid({ readers }: { readers: ReaderView[] }) {
  const done = readers.filter((reader) => reader.state === "done").length;
  return (
    <Panel
      eyebrow="Readers"
      title={`${done} of ${readers.length} page ranges read`}
      bodyClassName="flex flex-wrap gap-1.5 p-4"
    >
      {readers.map((reader) => (
        <span
          key={reader.readerId}
          title={
            reader.state === "done"
              ? `${reader.names ?? 0} candidates in ${duration(reader.ms ?? 0)}`
              : reader.state === "error"
                ? "Failed"
                : "Reading"
          }
          className={cx(
            "rounded-sm border px-2 py-1 font-mono text-[0.7rem] tabular-nums",
            reader.state === "start" &&
              "sv-reading border-federal-blue text-federal-blue",
            reader.state === "done" && "border-ink/30 bg-paper",
            reader.state === "error" &&
              "border-seal-red bg-seal-red/10 text-seal-red",
          )}
        >
          p{reader.from}–{reader.to}
          {reader.state === "done" ? (
            <span className="ml-1 text-ink-muted">· {reader.names ?? 0}</span>
          ) : null}
        </span>
      ))}
    </Panel>
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
function Timeline({ items, live }: { items: TimelineItem[]; live: boolean }) {
  const body = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail as items arrive
  useEffect(() => {
    const element = body.current;
    if (element && live && pinned.current)
      element.scrollTo({ top: element.scrollHeight });
  }, [items.length, live]);

  return (
    <Panel eyebrow="Timeline" title={`${items.length} steps`} bodyClassName="">
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
              ? "Waiting for the Analyst…"
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
