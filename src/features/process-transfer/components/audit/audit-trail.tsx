"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIT_ACTIONS, type AuditEvent } from "../../domain/run";
import { listAudit } from "../../server/actions";
import { when } from "../format";
import {
  Empty,
  fieldClass,
  focusRing,
  InlineError,
  quietButtonClass,
  Skeleton,
} from "../ui";

/** Shown one page at a time; a page shorter than this is the last. */
const PAGE = 100;

type Load =
  | { at: "loading" }
  | { at: "ready"; events: AuditEvent[]; more: boolean }
  | { at: "failed"; error: string };

/**
 * The append-only Audit trail: what a person and the pipeline did, newest
 * first, with each line's detail on demand. Can be narrowed to the open Run.
 */
export function AuditTrail({ openRunId }: { openRunId: string | null }) {
  const [onlyRun, setOnlyRun] = useState(false);
  /** Shown actors; the filter narrows what is loaded, it does not reload. */
  const [actor, setActor] = useState<"all" | AuditEvent["actor"]>("all");
  const runId = onlyRun && openRunId ? openRunId : undefined;
  const [load, setLoad] = useState<Load>({ at: "loading" });
  const [older, setOlder] = useState<{
    pending: boolean;
    error: string | null;
  }>({ pending: false, error: null });
  const [reloads, setReloads] = useState(0);
  const busy = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloads` is a trigger to load again
  useEffect(() => {
    let live = true;
    setLoad({ at: "loading" });
    listAudit(runId ? { runId } : undefined)
      .then((events) => {
        if (live) setLoad({ at: "ready", events, more: events.length >= PAGE });
      })
      .catch((error: unknown) => {
        if (live)
          setLoad({
            at: "failed",
            error:
              error instanceof Error && error.message
                ? error.message
                : "The Audit trail could not be loaded.",
          });
      });
    return () => {
      live = false;
    };
  }, [runId, reloads]);

  const loadOlder = useCallback(async () => {
    if (busy.current || load.at !== "ready") return;
    const last = load.events.at(-1);
    if (!last) return;
    busy.current = true;
    setOlder({ pending: true, error: null });
    try {
      const events = await listAudit({
        before: last.id,
        ...(runId ? { runId } : {}),
      });
      setLoad((current) =>
        current.at === "ready"
          ? {
              at: "ready",
              events: [...current.events, ...events],
              more: events.length >= PAGE,
            }
          : current,
      );
      setOlder({ pending: false, error: null });
    } catch {
      setOlder({
        pending: false,
        error: "Older lines could not be loaded. Try again.",
      });
    } finally {
      busy.current = false;
    }
  }, [load, runId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow text-ink-muted">Audit trail</p>
          <h2 className="font-mono text-lg font-bold tracking-[0.04em] uppercase">
            Everything that happened
          </h2>
          <p className="mt-1 text-sm">
            Every Run, model call with its cost, Rule change, Approval and
            download, written once and never changed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="eyebrow text-ink-muted">Show</span>
            <select
              value={actor}
              onChange={(event) => setActor(event.target.value as typeof actor)}
              className={`${fieldClass} w-auto`}
            >
              <option value="all">Everything</option>
              <option value="person">What a person did</option>
              <option value="pipeline">What the pipeline did</option>
            </select>
          </label>
          {openRunId ? (
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-federal-blue">
              <input
                type="checkbox"
                checked={onlyRun}
                onChange={(event) => setOnlyRun(event.target.checked)}
                className="size-4 accent-federal-blue"
              />
              This Run only
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => setReloads((count) => count + 1)}
            disabled={load.at === "loading"}
            className={quietButtonClass}
          >
            {load.at === "loading" ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {load.at === "loading" ? (
        <div className="outline-box rounded-sm bg-paper p-4" aria-busy="true">
          <Skeleton lines={8} />
        </div>
      ) : null}
      {load.at === "failed" ? (
        <div className="flex flex-col items-start gap-2">
          <InlineError>{load.error}</InlineError>
          <button
            type="button"
            onClick={() => setReloads((count) => count + 1)}
            className={quietButtonClass}
          >
            Try again
          </button>
        </div>
      ) : null}
      {load.at === "ready" && load.events.length === 0 ? (
        <Empty title="Nothing yet">
          {runId
            ? "This Run has no lines yet."
            : "Start a Run or change a Rule and it shows up here."}
        </Empty>
      ) : null}
      {load.at === "ready" && load.events.length > 0 ? (
        <>
          <ol className="outline-box divide-y divide-ink/10 rounded-sm bg-paper">
            {load.events
              .filter((event) => actor === "all" || event.actor === actor)
              .map((event) => (
                <AuditLine key={event.id} event={event} />
              ))}
          </ol>
          <div className="flex flex-col items-start gap-2">
            {load.more ? (
              <button
                type="button"
                onClick={loadOlder}
                disabled={older.pending}
                aria-busy={older.pending}
                className={quietButtonClass}
              >
                {older.pending ? "Loading…" : "Load older"}
              </button>
            ) : (
              <p className="text-xs text-ink-muted">
                That is the start of the trail.
              </p>
            )}
            <InlineError>{older.error}</InlineError>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AuditLine({ event }: { event: AuditEvent }) {
  const hasDetail = Object.keys(event.detail ?? {}).length > 0;
  const label = AUDIT_ACTIONS[event.action] ?? event.action;
  const head = (
    <div className="grid min-w-0 flex-1 gap-x-3 gap-y-0.5 sm:grid-cols-[8.5rem_6rem_minmax(0,1fr)]">
      <time
        dateTime={event.at}
        className="font-mono text-[11px] text-ink-muted sm:pt-0.5"
      >
        {when(event.at)}
      </time>
      <span
        className={`self-start justify-self-start rounded-sm px-1.5 font-mono text-[10px] font-bold tracking-[0.08em] uppercase ${event.actor === "person" ? "bg-federal-blue text-paper" : "bg-limestone text-ink"}`}
      >
        {event.actor === "person" ? "Person" : "Pipeline"}
      </span>
      <span className="min-w-0 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="block break-words text-ink-muted">
          {event.summary}
        </span>
      </span>
    </div>
  );
  if (!hasDetail) {
    return <li className="flex gap-2 px-3 py-2.5 pl-8">{head}</li>;
  }
  return (
    <li>
      <details className="group">
        <summary
          className={`flex cursor-pointer list-none gap-2 px-3 py-2.5 hover:bg-marble ${focusRing}`}
        >
          <span
            aria-hidden="true"
            className="w-3 pt-0.5 font-mono text-xs text-ink-muted transition-transform group-open:rotate-90"
          >
            ▸
          </span>
          {head}
        </summary>
        <pre className="mx-3 mb-3 max-h-80 overflow-auto rounded-sm bg-ink p-3 font-mono text-[11px] leading-relaxed text-paper/90">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      </details>
    </li>
  );
}
