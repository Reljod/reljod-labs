"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTOR_KINDS,
  type ActorKind,
  AGENT_LABEL,
  AUDIT_ACTIONS,
  type AuditAction,
  SYSTEM_LABEL,
} from "../../domain/audit";
import { LIMITS } from "../../domain/limits";
import { api, formatCost, keys, messageOf } from "../api";
import { EventRow } from "../audit/event-row";
import {
  ACTION_GROUPS,
  auditCsv,
  auditTotals,
  type EventLink,
  formatTokens,
  sessionChoices,
} from "../audit/model";
import { useHarness } from "../harness-context";
import {
  Button,
  cx,
  Empty,
  ErrorNote,
  Loading,
  Panel,
  segmentClass,
  segmentsClass,
} from "../ui";

type Scope = "session" | "mine" | "workspace";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "session", label: "This Session" },
  { id: "mine", label: "My Sessions" },
  { id: "workspace", label: "Workspace" },
];

const ACTOR_LABEL: Record<ActorKind, string> = {
  staff: "Staff",
  agent: AGENT_LABEL,
  system: SYSTEM_LABEL,
};

const REFRESH_MS = 5_000;

const selectClass =
  "h-8 min-w-0 rounded-sm outline-box bg-paper px-2 text-xs text-ink focus-visible:border-federal-blue focus-visible:outline-2 focus-visible:outline-federal-blue/30 disabled:bg-marble disabled:text-ink-muted";

function downloadCsv(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `harness-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * The Audit trail: every action by a Staff member, the Agent or the system
 * (ADR 0018). Scope, actor, action and Session filters; a totals strip for
 * what is on screen; CSV of the filtered view. It refreshes every few
 * seconds while it is the visible tab, unless paused. The server scopes what
 * a Role may read whatever is asked.
 */
export default function AuditTab() {
  const {
    staff,
    allStaff,
    can,
    place,
    sessionId,
    openSession,
    openRun,
    openTab,
  } = useHarness();
  const admin = can("audit.read.workspace");
  // Null until the person picks one: an admin starts on the Workspace (Rule
  // and Skill saves and Conflict settlements belong to no Session), a user on
  // their own Sessions.
  const [scope, setScope] = useState<Scope | null>(null);
  const [actor, setActor] = useState<ActorKind | "">("");
  const [action, setAction] = useState<AuditAction | "">("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(new Set());
  const [exported, setExported] = useState<string | null>(null);

  const visible = place.tab === "audit";
  // A user cannot read the Workspace; the server scopes them anyway.
  const chosenScope: Scope = scope ?? (admin ? "workspace" : "mine");
  const effectiveScope: Scope =
    !admin && chosenScope === "workspace" ? "mine" : chosenScope;

  const sessions = useQuery({
    queryKey: keys.sessions,
    queryFn: () => api.sessions.list(),
    enabled: visible,
  });
  const sessionId_ =
    effectiveScope === "session" ? sessionId : sessionFilter || null;
  const waitingForSession = effectiveScope === "session" && !sessionId;

  // An admin's "My Sessions" is asked of the server, so every page is the
  // admin's own Sessions' events and "Load more" pages through only those.
  const mine = admin && effectiveScope === "mine";

  const trail = useInfiniteQuery({
    queryKey: [
      ...keys.audit({
        sessionId: sessionId_,
        actorKind: actor || null,
        action: action || null,
        mine,
      }),
      effectiveScope,
    ],
    queryFn: ({ pageParam }) =>
      api.audit.list({
        sessionId: sessionId_,
        actorKind: actor || null,
        action: action || null,
        mine,
        before: pageParam,
        limit: LIMITS.auditPageSize,
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled: visible && !waitingForSession,
    refetchInterval: visible && !paused ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });

  const events = useMemo(
    () => trail.data?.pages.flatMap((page) => page.events) ?? [],
    [trail.data],
  );

  // Sessions the trail has shown: an admin sees other Staff's, which the list of one's own lacks.
  const [seen, setSeen] = useState<ReadonlyMap<string, string | null>>(
    new Map(),
  );
  useEffect(() => {
    setSeen((current) => {
      let next: Map<string, string | null> | null = null;
      for (const event of events) {
        if (!event.sessionId) continue;
        if (current.get(event.sessionId) === (event.sessionTitle ?? null))
          continue;
        next ??= new Map(current);
        next.set(event.sessionId, event.sessionTitle ?? null);
      }
      return next ?? current;
    });
  }, [events]);
  const choices = useMemo(
    () =>
      sessionChoices(
        (sessions.data ?? []).filter(
          (session) =>
            effectiveScope !== "mine" ||
            session.staff.id === staff.id ||
            !admin,
        ),
        effectiveScope === "mine" && admin ? new Map() : seen,
      ),
    [sessions.data, seen, effectiveScope, staff.id, admin],
  );

  const loadError = trail.error;
  const totals = useMemo(() => auditTotals(events), [events]);
  const staffById = useMemo(
    () => new Map(allStaff.map((member) => [member.id, member])),
    [allStaff],
  );

  const toggle = useCallback((id: number) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const follow = (link: EventLink) => {
    if (link.kind === "session") openSession(link.id);
    else if (link.kind === "run") openRun(link.id);
    else openTab(link.tab, link.params);
  };

  const exportCsv = () => {
    downloadCsv(auditCsv(events));
    setExported(`Exported ${events.length} events.`);
  };

  const filtered = actor !== "" || action !== "" || sessionFilter !== "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <Panel bodyClassName="p-3" className="shrink-0">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <fieldset className={cx("m-0 min-w-0 border-0 p-0", segmentsClass)}>
            <legend className="sr-only">Which events</legend>
            {SCOPES.map((item) => {
              const disabled = item.id === "workspace" && !admin;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={effectiveScope === item.id}
                  disabled={disabled}
                  title={
                    disabled
                      ? "Only an admin reads the whole Workspace's Audit trail. Switch Staff to try it."
                      : undefined
                  }
                  onClick={() => setScope(item.id)}
                  className={segmentClass(effectiveScope === item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </fieldset>

          <label className="flex flex-col gap-1 text-[0.65rem] text-ink-muted uppercase tracking-wider">
            Who
            <select
              className={selectClass}
              value={actor}
              onChange={(event) =>
                setActor(event.target.value as ActorKind | "")
              }
            >
              <option value="">Anyone</option>
              {ACTOR_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ACTOR_LABEL[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[0.65rem] text-ink-muted uppercase tracking-wider">
            Action
            <select
              className={cx(selectClass, "max-w-52")}
              value={action}
              onChange={(event) =>
                setAction(event.target.value as AuditAction | "")
              }
            >
              <option value="">Any action</option>
              {ACTION_GROUPS.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.actions.map((id) => (
                    <option key={id} value={id}>
                      {AUDIT_ACTIONS[id]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[0.65rem] text-ink-muted uppercase tracking-wider">
            Session
            <select
              className={cx(selectClass, "max-w-52 sm:max-w-72")}
              value={
                effectiveScope === "session" ? (sessionId ?? "") : sessionFilter
              }
              disabled={effectiveScope === "session"}
              onChange={(event) => setSessionFilter(event.target.value)}
            >
              <option value="">
                {effectiveScope === "session"
                  ? "The open Session"
                  : "Any Session"}
              </option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex items-center gap-2">
            {filtered ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setActor("");
                  setAction("");
                  setSessionFilter("");
                }}
              >
                Clear filters
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => setPaused((value) => !value)}
              aria-pressed={paused}
            >
              {paused ? "Resume refresh" : "Pause refresh"}
            </Button>
            <Button
              size="sm"
              onClick={exportCsv}
              disabled={events.length === 0}
            >
              Export CSV
            </Button>
          </div>
        </div>
        {!admin ? (
          <p className="mt-2 text-xs text-ink-muted">
            You read the Audit trail of your own Sessions. An admin reads the
            whole Workspace's.
          </p>
        ) : null}
        {exported ? (
          <p className="mt-2 text-xs text-ivy" aria-live="polite">
            {exported}
          </p>
        ) : null}
      </Panel>

      <dl className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Events", String(totals.events)],
          ["Agent calls", String(totals.agentCalls)],
          [
            "Tokens in / out",
            `${formatTokens(totals.inputTokens)} / ${formatTokens(totals.outputTokens)}`,
          ],
          [
            "Cost",
            `${totals.costPartial ? "≥ " : ""}${formatCost(totals.costUsd)}`,
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-sm outline-box bg-paper px-3 py-2"
          >
            <dt className="eyebrow text-[0.6rem] text-ink-muted">{label}</dt>
            <dd className="font-mono text-sm font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <Panel
        className="flex min-h-0 flex-1 flex-col"
        bodyClassName="hx-scroll min-h-0 flex-1 p-0"
      >
        {waitingForSession ? (
          <Empty title="No Session is open">
            Open a Session in Chat to see its Audit trail, or look at My
            Sessions.
          </Empty>
        ) : trail.isPending ? (
          <Loading rows={6} className="p-3" />
        ) : trail.isError ? (
          <div className="p-3">
            <ErrorNote onRetry={() => void trail.refetch()}>
              {messageOf(trail.error)}
            </ErrorNote>
          </div>
        ) : events.length === 0 ? (
          <Empty title="Nothing recorded here yet">
            {filtered
              ? "No events match these filters."
              : "Events appear as people and the Agent work."}
          </Empty>
        ) : (
          <>
            <ul>
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  staff={
                    event.staffId
                      ? (staffById.get(event.staffId) ?? null)
                      : null
                  }
                  open={openIds.has(event.id)}
                  onToggle={() => toggle(event.id)}
                  onLink={follow}
                />
              ))}
            </ul>
            <div className="flex items-center justify-center gap-3 p-3">
              {trail.hasNextPage ? (
                <Button
                  pending={trail.isFetchingNextPage}
                  pendingLabel="Loading…"
                  onClick={() => void trail.fetchNextPage()}
                >
                  Load more
                </Button>
              ) : (
                <p className="text-xs text-ink-muted">End of the trail.</p>
              )}
            </div>
            {trail.isFetchNextPageError ? (
              <div className="px-3 pb-3">
                <ErrorNote>{messageOf(loadError)}</ErrorNote>
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
