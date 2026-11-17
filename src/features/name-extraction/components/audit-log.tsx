"use client";

import { useMemo, useState } from "react";
import type { RunEvent } from "../domain/contract";
import {
  downloadText,
  duration,
  fileStem,
  modelLabel,
  tokens,
  usd,
} from "./format";
import type { SeqEvent } from "./run-view";
import { Button, cx, Panel, Tag } from "./ui";

type EventType = RunEvent["type"];

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

/** One line saying what the event was. */
export function eventSummary(event: RunEvent): string {
  switch (event.type) {
    case "start":
      return `${event.document.title} · ${event.document.pages} pages · Rulebook v${event.rulebookVersion}`;
    case "thought":
      return event.text;
    case "tool":
      return `${event.tool} ${event.state}${event.summary ? ` · ${event.summary}` : ""}`;
    case "skill":
      return `loaded ${event.skill}`;
    case "reader":
      return `Reader ${event.readerId} p${event.from}–${event.to} ${event.state}${event.names !== undefined ? ` · ${event.names} candidates` : ""}`;
    case "code":
      return `exit ${event.exitCode} · ${duration(event.ms)} · ${event.code.split("\n")[0].slice(0, 80)}`;
    case "names":
      return `${event.names.length} names recorded`;
    case "gate":
      return `${event.gate.pagesRead}/${event.gate.pagesTotal} pages read · ${event.gate.candidatesOpen} candidates open${event.gate.passed ? " · passed" : ""}`;
    case "cost":
      return `${event.purpose} · ${modelLabel(event.model)}`;
    case "log":
      return event.text;
    case "end":
      return `${event.status}${event.error ? ` · ${event.error}` : ""}${event.score ? ` · recall ${Math.round(event.score.recall * 100)}%` : ""}`;
  }
}

const TYPE_TONE: Partial<
  Record<EventType, "blue" | "brass" | "green" | "red" | "ink">
> = {
  start: "ink",
  end: "ink",
  tool: "blue",
  cost: "green",
  skill: "brass",
  code: "brass",
};

/**
 * The Audit trail: every event of the Run, in order, append-only. Filter by
 * type, open a row for its full payload, download it all as JSON.
 */
export function AuditLog({
  events,
  runId,
  title,
}: {
  events: SeqEvent[];
  runId: string;
  title: string;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<EventType>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const counts = useMemo(() => {
    const map = new Map<EventType, number>();
    for (const event of events)
      map.set(event.type, (map.get(event.type) ?? 0) + 1);
    return map;
  }, [events]);
  const shown = events.filter((event) => !hidden.has(event.type));

  const toggleType = (type: EventType) =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(type)) next.add(type);
      return next;
    });
  const toggleRow = (seq: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(seq)) next.add(seq);
      return next;
    });

  return (
    <Panel
      eyebrow="Audit trail"
      title={`${events.length} events, append-only`}
      actions={
        <Button
          size="sm"
          disabled={events.length === 0}
          onClick={() =>
            downloadText(
              JSON.stringify({ runId, events }, null, 2),
              `sieve-audit-${fileStem(title)}-${runId.slice(0, 8)}.json`,
              "application/json",
            )
          }
        >
          Download audit (JSON)
        </Button>
      }
      bodyClassName=""
    >
      <fieldset className="flex flex-wrap gap-1.5 border-ink/10 border-b px-4 py-2">
        <legend className="sr-only">Show event types</legend>
        {[...counts.entries()].map(([type, count]) => (
          <button
            key={type}
            type="button"
            aria-pressed={!hidden.has(type)}
            onClick={() => toggleType(type)}
            className={cx(
              "h-7 rounded-sm border px-2 font-mono text-xs",
              hidden.has(type)
                ? "border-ink/15 bg-paper text-ink-muted line-through"
                : "border-ink/40 bg-marble",
            )}
          >
            {type} {count}
          </button>
        ))}
      </fieldset>
      <ol className="sv-scroll max-h-[40rem] overflow-y-auto">
        {shown.length === 0 ? (
          <li className="px-4 py-3 text-sm text-ink-muted">No events.</li>
        ) : null}
        {shown.map((event) => {
          const isOpen = open.has(event.seq);
          return (
            <li key={event.seq} className="border-ink/10 border-b">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggleRow(event.seq)}
                className="grid w-full gap-x-3 gap-y-0.5 px-4 py-1.5 text-left hover:bg-marble/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue sm:grid-cols-[3rem_7.5rem_5rem_minmax(0,1fr)]"
              >
                <span className="font-mono text-xs text-ink-muted tabular-nums">
                  #{event.seq}
                </span>
                <span className="font-mono text-xs text-ink-muted tabular-nums">
                  {TIME.format(new Date(event.at))}
                </span>
                <span>
                  <Tag tone={TYPE_TONE[event.type] ?? "neutral"}>
                    {event.type}
                  </Tag>
                </span>
                <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                  <span className="line-clamp-2">{eventSummary(event)}</span>
                  {event.type === "cost" ? (
                    <span className="flex flex-wrap gap-x-3 font-mono text-[0.7rem] text-ink-muted">
                      <span>{event.model}</span>
                      <span>
                        {tokens(event.inputTokens)} in
                        {event.cachedInputTokens > 0
                          ? ` (${tokens(event.cachedInputTokens)} cached)`
                          : ""}{" "}
                        / {tokens(event.outputTokens)} out
                      </span>
                      <span>{usd(event.costUsd)}</span>
                      <span>{duration(event.ms)}</span>
                    </span>
                  ) : null}
                </span>
              </button>
              {isOpen ? (
                <pre className="sv-scroll max-h-96 overflow-auto border-ink/10 border-t bg-marble/40 px-4 py-2 font-mono text-[0.7rem] whitespace-pre-wrap sm:pl-[17rem]">
                  {JSON.stringify(event, null, 2)}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
