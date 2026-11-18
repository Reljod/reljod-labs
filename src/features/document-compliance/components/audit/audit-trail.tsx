"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  AUDIT_ACTION_IDS,
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEventView,
  type AuditPage,
} from "../../domain/audit";
import { formatTokens, formatUsd } from "../../metrics";
import { auditQuery } from "../queries";

const ACTOR_STYLES: Record<AuditEventView["actor"]["kind"], string> = {
  person: "bg-federal-blue text-paper",
  model: "bg-brass text-ink",
  system: "bg-limestone text-ink",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function download(events: AuditEventView[], runId: string | null) {
  const blob = new Blob([JSON.stringify(events, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = runId ? `audit-run-${runId}.json` : "audit-trail.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The Owner's Audit trail, newest first: who did what, when, with which Rule
 * Versions and which model at what cost. Events are only ever added (ADR 0019).
 * With `runId`, only that run's events.
 */
export function AuditTrail({
  runId = null,
  initialPage,
}: {
  runId?: string | null;
  /** The first unfiltered page, read by the page on the server. */
  initialPage?: AuditPage;
}) {
  const [action, setAction] = useState<AuditAction | "">("");
  const trail = useInfiniteQuery({
    ...auditQuery(runId, action),
    // Only the unfiltered trail was read on the server.
    initialData:
      initialPage && action === ""
        ? { pages: [initialPage], pageParams: [null] }
        : undefined,
    // A new filter keeps the old list on screen (marked busy) until it lands.
    placeholderData: keepPreviousData,
  });
  const events = trail.data?.pages.flatMap((page) => page.events) ?? [];
  // A new filter is loading while the previous list stays on screen.
  const refiltering = trail.isPlaceholderData;

  return (
    <section
      aria-label="Audit trail"
      data-testid="audit-trail"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
          Action
          <select
            data-testid="audit-filter-action"
            value={action}
            onChange={(event) =>
              setAction(event.target.value as AuditAction | "")
            }
            className="rounded-sm border-2 border-ink bg-paper px-2 py-1 font-mono text-xs"
          >
            <option value="">Every action</option>
            {AUDIT_ACTION_IDS.map((id) => (
              <option key={id} value={id}>
                {AUDIT_ACTIONS[id]}
              </option>
            ))}
          </select>
        </label>
        <output aria-live="polite" className="font-mono text-xs text-ink-muted">
          {trail.isPending || refiltering
            ? "Loading events…"
            : `${events.length} event${events.length === 1 ? "" : "s"}${
                trail.hasNextPage ? " loaded" : ""
              }`}
        </output>
        <button
          type="button"
          data-testid="audit-export"
          disabled={events.length === 0}
          onClick={() => download(events, runId)}
          className="outline-box press ml-auto rounded-sm bg-paper px-3 py-2 font-mono text-xs font-bold uppercase disabled:opacity-40"
        >
          ↓ Export JSON
        </button>
      </div>

      {trail.isPending ? (
        <AuditSkeleton />
      ) : trail.isError ? (
        <p
          role="alert"
          className="outline-box rounded-sm bg-limestone px-4 py-3"
        >
          ✕ Could not load the Audit trail. Try again in a moment.
        </p>
      ) : events.length === 0 ? (
        <p className="outline-box rounded-sm bg-paper px-4 py-6 text-center text-sm text-ink-muted">
          Nothing recorded yet. Start a Pre-screen or edit a Rule and it shows
          up here.
        </p>
      ) : (
        <ol
          aria-busy={refiltering}
          className={`outline-box divide-y divide-ink/15 rounded-sm bg-paper transition-opacity ${
            refiltering ? "opacity-60" : ""
          }`}
        >
          {events.map((event) => (
            <EventRow key={event.id} event={event} showRun={!runId} />
          ))}
        </ol>
      )}

      {trail.hasNextPage ? (
        <button
          type="button"
          data-testid="audit-more"
          onClick={() => trail.fetchNextPage()}
          disabled={trail.isFetchingNextPage}
          aria-busy={trail.isFetchingNextPage}
          className="outline-box press self-center rounded-sm bg-paper px-4 py-2 font-mono text-xs font-bold uppercase"
        >
          {trail.isFetchingNextPage ? "Loading…" : "Load older events"}
        </button>
      ) : null}
    </section>
  );
}

/** Rows shaped like Audit events, while the first page loads. */
export function AuditSkeleton({
  rows = 5,
  withToolbar = false,
}: {
  rows?: number;
  /** The page's fallback stands in for the filter row too, so nothing shifts. */
  withToolbar?: boolean;
}) {
  const list = (
    <ol
      aria-busy="true"
      aria-label="Loading the Audit trail"
      className="outline-box divide-y divide-ink/15 rounded-sm bg-paper"
    >
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <li key={index} className="flex animate-pulse flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-28 rounded-sm bg-limestone" />
            <span className="h-4 w-14 rounded-sm bg-limestone" />
            <span className="h-3 w-32 rounded-sm bg-limestone" />
          </div>
          <span className="h-3.5 w-3/4 rounded-sm bg-limestone" />
        </li>
      ))}
    </ol>
  );
  if (!withToolbar) return list;
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" aria-live="polite">
        Loading the Audit trail…
      </span>
      <div className="flex items-center gap-2">
        <span className="h-8 w-48 animate-pulse rounded-sm bg-limestone" />
        <span className="ml-auto h-9 w-32 animate-pulse rounded-sm bg-limestone" />
      </div>
      {list}
    </div>
  );
}

function EventRow({
  event,
  showRun,
}: {
  event: AuditEventView;
  showRun: boolean;
}) {
  const hasDetails = Object.keys(event.details).length > 0;
  return (
    <li
      data-testid="audit-event"
      data-action={event.action}
      className="flex flex-col gap-1.5 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <time dateTime={event.at} className="text-ink-muted">
          {when(event.at)}
        </time>
        <span
          className={`eyebrow rounded-sm px-1.5 py-0.5 ${ACTOR_STYLES[event.actor.kind]}`}
        >
          {event.actor.label}
        </span>
        <span className="font-bold uppercase">
          {AUDIT_ACTIONS[event.action]}
        </span>
        {event.usage ? (
          <span className="text-ink-muted">
            {formatTokens(event.usage.inputTokens)} in ·{" "}
            {formatTokens(event.usage.outputTokens)} out ·{" "}
            {formatUsd(event.usage.costUsd)}
          </span>
        ) : null}
        {showRun && event.runId ? (
          <Link
            href={`/demos/document-compliance/runs/${event.runId}`}
            className="ml-auto text-federal-blue underline"
          >
            run {event.runId.slice(0, 8)} →
          </Link>
        ) : null}
      </div>
      <p className="text-sm">{event.summary}</p>
      {hasDetails ? (
        <details className="font-mono text-[11px]">
          <summary className="cursor-pointer text-ink-muted">Details</summary>
          <pre className="mt-1 overflow-x-auto rounded-sm bg-limestone p-2">
            {JSON.stringify(event.details, null, 2)}
          </pre>
        </details>
      ) : null}
    </li>
  );
}
