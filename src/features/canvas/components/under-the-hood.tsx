"use client";

import { useCallback, useEffect, useState } from "react";
import type { MessageUsage } from "../domain/chat";
import { LIMITS } from "../domain/limits";
import { ACTOR_LABEL, TRAIL_ACTIONS, type TrailEvent } from "../domain/trail";
import { trail as loadTrail } from "./api";
import { Badge, Button, Panel } from "./ui";
import type { BridgeLog } from "./view-frame";

const TONE: Record<string, "blue" | "green" | "amber" | "red" | "neutral"> = {
  "model.called": "blue",
  "query.refused": "red",
  "view.refused": "red",
  "tool.failed": "red",
  "view.created": "green",
  "view.updated": "amber",
};

const time = (iso: string | number) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

function EventRow({ event }: { event: TrailEvent }) {
  const sql = typeof event.detail.sql === "string" ? event.detail.sql : null;
  const code = typeof event.detail.code === "string" ? event.detail.code : null;
  return (
    <li>
      <details className="px-4 py-2">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-mono text-ink-muted">
            {time(event.createdAt)}
          </span>
          <Badge tone={TONE[event.action] ?? "neutral"}>
            {TRAIL_ACTIONS[event.action]}
          </Badge>
          <span className="font-mono text-[0.65rem] text-ink-muted uppercase">
            {ACTOR_LABEL[event.actorKind]}
          </span>
          <span className="min-w-0 flex-1 basis-48 truncate">
            {event.summary}
          </span>
          {event.ms !== null ? (
            <span className="font-mono text-ink-muted">{event.ms} ms</span>
          ) : null}
          {event.costUsd !== null ? (
            <span className="font-mono text-ink-muted">
              {event.inputTokens}/{event.outputTokens} tok · $
              {event.costUsd.toFixed(4)}
            </span>
          ) : null}
        </summary>
        {sql ? (
          <pre className="mt-2 overflow-auto bg-marble p-2 font-mono text-[0.68rem] whitespace-pre-wrap">
            {sql}
          </pre>
        ) : null}
        {code ? (
          <pre className="mt-2 overflow-auto bg-marble p-2 font-mono text-[0.68rem] whitespace-pre-wrap">
            {code}
          </pre>
        ) : null}
        <pre className="mt-2 max-h-72 overflow-auto bg-marble p-2 font-mono text-[0.65rem] whitespace-pre-wrap">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      </details>
    </li>
  );
}

/** What ran: the Trail of this Conversation, what it cost, and the Bridge messages of the Views on screen. */
export function UnderTheHood({
  conversationId,
  bridge,
  usage,
}: {
  conversationId: string | null;
  bridge: BridgeLog[];
  usage: Omit<MessageUsage, "type"> | null;
}) {
  const [events, setEvents] = useState<TrailEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await loadTrail({ conversationId });
      setEvents(response.events);
    } catch (failure) {
      setError((failure as Error).message);
    }
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const modelCalls = (events ?? []).filter(
    (event) => event.action === "model.called",
  );
  const cost = modelCalls.reduce((sum, event) => sum + (event.costUsd ?? 0), 0);
  const runs = (events ?? []).filter(
    (event) =>
      event.action === "query.finished" || event.action === "code.finished",
  );

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]"
      id="cv-panel-hood"
    >
      <Panel
        eyebrow={
          conversationId
            ? "This Conversation"
            : "Everything of yours, newest first"
        }
        title="The Trail"
        bodyClassName=""
        actions={
          <Button
            size="sm"
            pending={loading}
            pendingLabel="Loading…"
            onClick={() => void load()}
          >
            Refresh
          </Button>
        }
      >
        <dl className="grid grid-cols-2 gap-px border-ink/15 border-b bg-ink/15 text-sm sm:grid-cols-4">
          {[
            ["Model", usage?.model ?? modelCalls[0]?.model ?? "–"],
            [
              "Turns",
              `${modelCalls.length} of ${LIMITS.turnsPerQuestion} per Question`,
            ],
            [
              "Model spend",
              `$${cost.toFixed(4)} (cap $${LIMITS.usdPerQuestion.toFixed(2)} per Question)`,
            ],
            [
              "Sandbox runs",
              `${runs.length}, ${(runs.reduce((sum, event) => sum + (event.ms ?? 0), 0) / 1000).toFixed(1)} s`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="bg-paper px-4 py-2">
              <dt className="eyebrow text-[0.65rem] text-ink-muted">{label}</dt>
              <dd className="font-mono text-xs font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {error ? (
          <p role="alert" className="px-4 py-3 text-sm text-seal-red">
            {error}
          </p>
        ) : null}
        <ul className="divide-y divide-ink/15" data-testid="trail">
          {(events ?? []).map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
          {events?.length === 0 ? (
            <li className="px-4 py-6 text-sm text-ink-muted">
              Nothing yet. Ask a Question.
            </li>
          ) : null}
        </ul>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel eyebrow="MCP Apps" title="Bridge messages" bodyClassName="">
          <p className="border-ink/15 border-b px-4 py-2 text-xs text-ink-muted">
            JSON-RPC over postMessage between this page (the Host) and each
            View's sandboxed frame (the App), on the wire format of 2026-01-26.
            A Control sends <span className="font-mono">tools/call</span>; the
            Host proxies it to the MCP server; no model is involved.
          </p>
          <ul
            className="max-h-[28rem] divide-y divide-ink/10 overflow-auto font-mono text-[0.68rem]"
            data-testid="bridge-log"
          >
            {bridge.length === 0 ? (
              <li className="px-4 py-4 font-sans text-sm text-ink-muted">
                No View has been opened on this page yet.
              </li>
            ) : null}
            {[...bridge].reverse().map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log.
              <li key={bridge.length - index} className="flex gap-2 px-4 py-1">
                <span className="text-ink-muted">{time(entry.at)}</span>
                <span
                  className={
                    entry.direction === "app → host"
                      ? "text-federal-blue"
                      : "text-ivy"
                  }
                >
                  {entry.direction}
                </span>
                <span className="font-bold">{entry.method}</span>
                {entry.note ? (
                  <span className="min-w-0 truncate text-ink-muted">
                    {entry.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel eyebrow="Owned by code" title="The caps">
          <ul className="space-y-1 text-sm">
            <li>{LIMITS.questionsPerHour} Questions an hour per visitor</li>
            <li>
              {LIMITS.turnsPerQuestion} model turns and $
              {LIMITS.usdPerQuestion.toFixed(2)} per Question
            </li>
            <li>
              {LIMITS.sandboxSecondsPerQuestion} s of Sandbox time per Question
            </li>
            <li>
              {LIMITS.runSeconds} s and{" "}
              {LIMITS.rowsReturned.toLocaleString("en")} rows per Query at most;
              Rules may lower both
            </li>
            <li>{LIMITS.runsPerHour} Runs an hour, Control changes included</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
