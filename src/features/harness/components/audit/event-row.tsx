"use client";

import { AUDIT_ACTIONS, type AuditEvent } from "../../domain/audit";
import type { Staff } from "../../domain/staff";
import { formatCost } from "../api";
import { Badge, cx, Initials, RoleBadge } from "../ui";
import {
  type DetailRow,
  detailRows,
  type EventLink,
  eventLinks,
  formatTokens,
  sessionHue,
  shortId,
} from "./model";

const TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const formatTime = (iso: string) => TIME.format(new Date(iso));

const TARGET = (event: AuditEvent) =>
  event.targetKind
    ? `${event.targetKind}${event.targetId ? ` ${event.targetId.length > 24 ? `${event.targetId.slice(0, 8)}…` : event.targetId}` : ""}`
    : null;

/**
 * One Audit event. Staff events show who (with their Role); Agent events add
 * the model, tokens and cost; System events are small and quiet. Press the
 * row to read the detail as key and value and to follow its links. Below the
 * `sm` breakpoint the columns stack into a card.
 */
export function EventRow({
  event,
  staff,
  open,
  onToggle,
  onLink,
}: {
  event: AuditEvent;
  /** The Staff member of a Staff event, if still in the Workspace. */
  staff: Staff | null;
  open: boolean;
  onToggle: () => void;
  onLink: (link: EventLink) => void;
}) {
  const quiet = event.actorKind === "system";
  const agent = event.actorKind === "agent";
  const sessionId = event.sessionId;
  const hue = sessionId ? sessionHue(sessionId) : null;
  const sessionRows: DetailRow[] = sessionId
    ? [
        {
          key: "session",
          value: event.sessionTitle
            ? `${sessionId} (${event.sessionTitle})`
            : sessionId,
        },
      ]
    : [];
  const rows = open
    ? [...sessionRows, ...detailRows(event.detail, event.action)]
    : [];
  const links = open ? eventLinks(event) : [];
  const target = TARGET(event);
  return (
    <li
      style={
        hue === null
          ? undefined
          : { borderLeft: `3px solid hsl(${hue} 55% 50%)` }
      }
      className={cx(
        "relative border-ink/10 border-b",
        quiet && "bg-marble/40 text-ink-muted",
        hue === null && agent && "border-l-2 border-l-federal-blue/50",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-marble/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue sm:grid-cols-[8.5rem_11rem_10rem_minmax(0,1fr)]"
      >
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {formatTime(event.createdAt)}
          {/* Room for the Session chip, which sits over it (a button cannot nest in a button). */}
          {sessionId ? <span aria-hidden="true" className="block h-5" /> : null}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {event.actorKind === "staff" ? (
            <>
              <Initials
                initials={
                  staff?.initials ?? event.actorLabel.slice(0, 2).toUpperCase()
                }
                role={staff?.role ?? "user"}
                className="size-6"
              />
              <span className="min-w-0 truncate text-sm font-medium">
                {event.actorLabel}
              </span>
              {staff ? <RoleBadge role={staff.role} /> : null}
            </>
          ) : (
            <Badge tone={agent ? "blue" : "neutral"}>{event.actorLabel}</Badge>
          )}
        </span>
        <span
          className={cx("min-w-0 text-sm", quiet ? "text-xs" : "font-medium")}
        >
          {AUDIT_ACTIONS[event.action] ?? event.action}
        </span>
        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
          <span className={quiet ? "text-xs" : undefined}>{event.summary}</span>
          {target ? (
            <span className="ml-2 font-mono text-[0.7rem] text-ink-muted">
              {target}
            </span>
          ) : null}
          {agent && event.model ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.7rem] text-ink-muted">
              <span>{event.model}</span>
              <span>
                {formatTokens(event.inputTokens ?? 0)} in /{" "}
                {formatTokens(event.outputTokens ?? 0)} out
              </span>
              <span>{formatCost(event.costUsd)}</span>
            </span>
          ) : null}
        </span>
      </button>
      {sessionId && hue !== null ? (
        <button
          type="button"
          onClick={() =>
            onLink({ kind: "session", label: "Open Session", id: sessionId })
          }
          title={`${event.sessionTitle ?? "Session"}: open it`}
          aria-label={`Open Session ${event.sessionTitle ?? ""} ${shortId(sessionId)}`.replace(
            /\s+/g,
            " ",
          )}
          style={{
            backgroundColor: `hsl(${hue} 70% 94%)`,
            borderColor: `hsl(${hue} 45% 60%)`,
          }}
          className="absolute top-[1.65rem] left-3 z-10 inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[0.68rem] leading-4 text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-federal-blue"
        >
          <span
            aria-hidden="true"
            style={{ backgroundColor: `hsl(${hue} 60% 42%)` }}
            className="size-1.5 rounded-full"
          />
          {shortId(sessionId)}
        </button>
      ) : null}
      {open ? (
        <div className="space-y-2 border-ink/10 border-t bg-marble/30 px-3 py-3 sm:pl-[9.5rem]">
          {rows.length > 0 ? (
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)]">
              {rows.map((row) => (
                <div key={row.key} className="contents">
                  <dt className="font-mono text-ink-muted [overflow-wrap:anywhere]">
                    {row.key}
                  </dt>
                  <dd className="[overflow-wrap:anywhere]">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-ink-muted">
              No more detail was recorded.
            </p>
          )}
          {links.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {links.map((link) => (
                <button
                  key={`${link.kind}-${link.label}`}
                  type="button"
                  onClick={() => onLink(link)}
                  className="rounded-sm border border-ink/25 bg-paper px-2 py-1 text-xs font-medium hover:border-ink/50 hover:bg-marble"
                >
                  {link.label}
                </button>
              ))}
            </div>
          ) : null}
          <p className="font-mono text-[0.65rem] text-ink-muted">
            Event {event.id} · {event.createdAt}
          </p>
        </div>
      ) : null}
    </li>
  );
}
