"use client";

import type { AuditEventView } from "../../domain/views";
import { formatBankStamp, formatStamp } from "../shell/time";
import { Badge, cx, type Tone } from "../ui";

export const ACTOR_TONE: Record<AuditEventView["actorKind"], Tone> = {
  staff: "ink",
  teller: "blue",
  client: "amber",
  system: "neutral",
};

const VIA_LABEL: Record<string, string> = {
  app: "app",
  chat: "chat",
  mcp: "MCP",
  workflow: "workflow",
};

const tokens = (value: number | null) =>
  value === null
    ? "–"
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(value);

const cost = (usd: number | null) =>
  usd === null
    ? null
    : usd < 0.01
      ? `$${usd.toFixed(4)}`
      : `$${usd.toFixed(2)}`;

/**
 * One Audit event: when (bank time, and the real time it was written), who
 * and how, the action and what it said. A Teller event adds the model, tokens
 * and cost. Press it to read the detail. On a phone the columns stack.
 */
export function EventRow({
  event,
  open,
  onToggle,
}: {
  event: AuditEventView;
  open: boolean;
  onToggle: () => void;
}) {
  const quiet = event.actorKind === "system";
  const hasDetail = Object.keys(event.detail).length > 0;
  return (
    <li
      className={cx("border-ink/15 border-b", quiet && "bg-marble/40")}
      data-testid="bank-audit-event"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-marble/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue md:grid-cols-[9.5rem_12rem_11rem_minmax(0,1fr)]"
      >
        <span className="font-mono text-xs tabular-nums">
          <span className="block" title="Bank time">
            {formatBankStamp(event.bankTime)}
          </span>
          <span
            className="block text-[0.65rem] text-ink-muted"
            title="Real time"
          >
            {formatStamp(event.createdAt)}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium">
            {event.actorLabel}
          </span>
          <Badge tone={ACTOR_TONE[event.actorKind]}>{event.actorKind}</Badge>
          <Badge tone="neutral">{VIA_LABEL[event.via] ?? event.via}</Badge>
        </span>
        <span
          className={cx(
            "min-w-0 font-mono text-xs [overflow-wrap:anywhere]",
            quiet ? "text-ink-muted" : "font-bold",
          )}
        >
          {event.action}
        </span>
        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
          <span className={quiet ? "text-xs text-ink-muted" : undefined}>
            {event.summary}
          </span>
          {event.model ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.7rem] text-ink-muted">
              <span>{event.model}</span>
              <span>
                {tokens(event.inputTokens)} in / {tokens(event.outputTokens)}{" "}
                out
              </span>
              {cost(event.costUsd) ? <span>{cost(event.costUsd)}</span> : null}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="border-ink/10 border-t bg-marble/50 px-3 py-2">
          <dl className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.7rem] text-ink-muted">
            <div>
              <dt className="inline">event </dt>
              <dd className="inline text-ink">#{event.id}</dd>
            </div>
            {event.targetKind ? (
              <div>
                <dt className="inline">{event.targetKind} </dt>
                <dd className="inline text-ink [overflow-wrap:anywhere]">
                  {event.targetId ?? ""}
                </dd>
              </div>
            ) : null}
            {event.sessionId ? (
              <div>
                <dt className="inline">session </dt>
                <dd className="inline text-ink">{event.sessionId}</dd>
              </div>
            ) : null}
          </dl>
          {hasDetail ? (
            <pre className="max-h-72 overflow-auto rounded-sm border border-ink/30 bg-paper p-2 font-mono text-[0.7rem] leading-relaxed whitespace-pre">
              {JSON.stringify(event.detail, null, 2)}
            </pre>
          ) : (
            <p className="text-xs text-ink-muted">No detail recorded.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}
