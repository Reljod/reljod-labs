"use client";

import { useCallback, useEffect, useId, useState } from "react";
import type { ActorKind } from "../../domain/audit";
import type { AuditEventView, AuditPage } from "../../domain/views";
import { EventRow } from "../audit/event-row";
import { ListSkeleton, ReadError } from "../operations/figures";
import { OlderPages, type Paged, useOlderPages } from "../shell/paged";
import {
  Button,
  cx,
  Empty,
  inputClass,
  Panel,
  segmentClass,
  segmentsClass,
} from "../ui";
import { useBank, useRead } from "../use-bank";

const ACTORS: { id: ActorKind | ""; label: string }[] = [
  { id: "", label: "Anyone" },
  { id: "staff", label: "Staff" },
  { id: "teller", label: "Teller" },
  { id: "client", label: "Client" },
  { id: "system", label: "System" },
];

const REFRESH_MS = 5_000;

const select = (page: AuditPage): Paged<AuditEventView> => ({
  items: page.events,
  next: page.nextBeforeId,
});

/** The most quick chips of actions seen. */
const CHIPS = 16;

/**
 * The Audit trail: every write, every Teller step, every Workflow step, in
 * the transaction it happened in. Filter by who acted and by the exact
 * action; it refreshes every few seconds while it is the visible tab.
 */
export function AuditTab() {
  const { tab } = useBank();
  const visible = tab === "audit";
  const [actor, setActor] = useState<ActorKind | "">("");
  const [action, setAction] = useState("");
  const [typed, setTyped] = useState("");
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [seen, setSeen] = useState<string[]>([]);
  const actionId = useId();

  const input = {
    ...(actor ? { actorKind: actor } : {}),
    ...(action ? { action } : {}),
  };
  const head = useRead<AuditPage>("list_audit", input, {
    enabled: visible,
    refetchMs: visible && !paused ? REFRESH_MS : false,
  });
  const older = useOlderPages(JSON.stringify(input));

  // Actions seen so far become quick chips, most recent first.
  const events = head.data?.events;
  useEffect(() => {
    if (!events) return;
    setSeen((current) => {
      const next = [...current];
      for (const event of events)
        if (!next.includes(event.action)) next.push(event.action);
      return next.length === current.length ? current : next.slice(0, 60);
    });
  }, [events]);

  const toggle = useCallback((id: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const applyAction = (value: string) => {
    const clean = value.trim();
    setTyped(clean);
    setAction(clean);
  };
  const filtered = actor !== "" || action !== "";
  const render = (items: AuditEventView[]) =>
    items.map((event) => (
      <EventRow
        key={event.id}
        event={event}
        open={open.has(event.id)}
        onToggle={() => toggle(event.id)}
      />
    ));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <Panel bodyClassName="space-y-3 p-3" className="shrink-0">
        <p className="text-xs">
          <span className="eyebrow mr-1.5 text-[0.6rem] font-bold">
            Append-only.
          </span>
          <span className="text-ink-muted">
            The database refuses UPDATE and DELETE on this table.
          </span>
        </p>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <fieldset className={cx("m-0 min-w-0 border-0 p-0", segmentsClass)}>
            <legend className="sr-only">Who acted</legend>
            {ACTORS.map((item) => (
              <button
                key={item.id || "any"}
                type="button"
                aria-pressed={actor === item.id}
                onClick={() => setActor(item.id)}
                className={segmentClass(actor === item.id)}
                data-testid={`bank-audit-actor-${item.id || "any"}`}
              >
                {item.label}
              </button>
            ))}
          </fieldset>
          <form
            className="flex min-w-0 flex-1 basis-56 items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyAction(typed);
            }}
          >
            <label
              htmlFor={actionId}
              className="flex min-w-0 flex-1 flex-col gap-1"
            >
              <span className="eyebrow text-[0.6rem] font-bold text-ink-muted">
                Action (exact name)
              </span>
              <input
                id={actionId}
                value={typed}
                maxLength={60}
                placeholder="advance_clock"
                onChange={(event) => setTyped(event.target.value)}
                onBlur={() => applyAction(typed)}
                className={cx(inputClass, "h-8 py-1 font-mono text-xs")}
                data-testid="bank-audit-action"
              />
            </label>
            <Button size="sm" type="submit">
              Filter
            </Button>
          </form>
          <div className="ml-auto flex items-center gap-2">
            {filtered ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setActor("");
                  applyAction("");
                }}
              >
                Clear
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => setPaused((value) => !value)}
              aria-pressed={paused}
            >
              {paused ? "Resume refresh" : "Pause refresh"}
            </Button>
          </div>
        </div>
        {seen.length > 0 ? (
          <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
            <legend className="sr-only">Actions seen</legend>
            {seen.slice(0, CHIPS).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={action === name}
                onClick={() => applyAction(action === name ? "" : name)}
                className={cx(
                  segmentClass(action === name),
                  "h-6 font-mono normal-case tracking-normal",
                )}
              >
                {name}
              </button>
            ))}
          </fieldset>
        ) : null}
      </Panel>

      <Panel
        className="flex min-h-0 flex-1 flex-col"
        bodyClassName="tb-scroll min-h-0 flex-1 p-0"
      >
        {head.isPending ? (
          <ListSkeleton
            rows={8}
            height="h-10"
            label="Reading the Audit trail…"
          />
        ) : !head.data ? (
          <ReadError error={head.error} onRetry={() => void head.refetch()} />
        ) : head.data.events.length === 0 ? (
          <Empty title="Nothing recorded here yet">
            {filtered
              ? "No events match these filters."
              : "Events appear as people, the Teller and the bank work."}
          </Empty>
        ) : (
          <ul
            aria-busy={head.isFetching || undefined}
            data-testid="bank-audit-list"
          >
            {render(head.data.events)}
            <OlderPages
              name="list_audit"
              input={input}
              select={select}
              render={render}
              head={select(head.data)}
              cursors={older.cursors}
              onMore={older.more}
              endLabel="The beginning of this bank's trail."
              testId="bank-audit-older"
            />
          </ul>
        )}
      </Panel>
    </div>
  );
}
