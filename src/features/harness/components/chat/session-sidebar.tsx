"use client";

import { useState } from "react";
import { LIMITS } from "../../domain/limits";
import { SESSION_TITLE_CHARS, type SessionSummary } from "../../domain/session";
import { timeAgo } from "../pipelines/format";
import { Button, cx, ErrorNote, Loading, Spinner, useWrite } from "../ui";

function RunningDot({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="hx-pulse size-2 shrink-0 rounded-full bg-federal-blue"
    />
  );
}

function SessionRow({
  session,
  active,
  running,
  runningLabel,
  onSelect,
  onRename,
}: {
  session: SessionSummary;
  active: boolean;
  running: boolean;
  runningLabel: string;
  onSelect: () => void;
  onRename: (title: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const rename = useWrite(onRename);

  const save = async () => {
    const next = title.trim();
    if (!next || next === session.title) {
      setEditing(false);
      return;
    }
    const done = await rename.run(next);
    if (done !== undefined) setEditing(false);
  };

  if (editing) {
    return (
      <li className="rounded-sm border border-federal-blue bg-paper p-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-1.5"
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: the person just chose Rename
            autoFocus
            value={title}
            maxLength={SESSION_TITLE_CHARS}
            aria-label="Session title"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !rename.pending) {
                event.stopPropagation();
                setEditing(false);
              }
            }}
            className="w-full rounded-sm border border-ink/30 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-federal-blue"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              type="submit"
              pending={rename.pending}
              pendingLabel="Saving…"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={rename.pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
          <ErrorNote>{rename.error}</ErrorNote>
        </form>
      </li>
    );
  }

  return (
    <li
      className={cx(
        "group flex items-stretch rounded-sm border",
        active
          ? "border-federal-blue bg-morning-haze/60"
          : "border-transparent hover:bg-marble",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="min-w-0 flex-1 rounded-sm px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-federal-blue"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {session.title}
          </span>
          {running ? <RunningDot label={runningLabel} /> : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">
          {session.preview || "No messages yet"}
        </span>
        <span className="mt-0.5 block text-[0.68rem] text-stone">
          {timeAgo(session.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          setTitle(session.title);
          rename.reset();
          setEditing(true);
        }}
        aria-label={`Rename ${session.title}`}
        className="shrink-0 self-start rounded-sm px-2 py-2 text-xs text-ink-muted opacity-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-federal-blue md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        Rename
      </button>
    </li>
  );
}

/** The Staff member's Sessions, newest first, with a mark on every one that is answering or has a Run at work. */
export function SessionSidebar({
  sessions,
  loading,
  error,
  onRetry,
  activeId,
  streamingIds,
  activeRunSessionIds,
  onSelect,
  onNew,
  creating,
  createError,
  onRename,
}: {
  sessions: SessionSummary[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  activeId: string | null;
  streamingIds: ReadonlySet<string>;
  activeRunSessionIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  creating: boolean;
  createError: string | null;
  onRename: (id: string, title: string) => Promise<unknown>;
}) {
  return (
    <nav aria-label="Sessions" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-ink/10 border-b p-2.5">
        <Button
          variant="primary"
          size="md"
          className="w-full"
          onClick={onNew}
          pending={creating}
          pendingLabel="Opening…"
        >
          New Session
        </Button>
        <ErrorNote>{createError}</ErrorNote>
      </div>
      <div className="hx-scroll min-h-0 flex-1 p-1.5">
        {loading ? (
          <Loading rows={4} className="p-1" />
        ) : error ? (
          <ErrorNote className="m-1" onRetry={onRetry}>
            {error}
          </ErrorNote>
        ) : sessions && sessions.length > 0 ? (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const answering = streamingIds.has(session.id);
              const run = activeRunSessionIds.has(session.id);
              return (
                <SessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  running={answering || run}
                  runningLabel={
                    answering && run
                      ? "The Agent is answering and a Run is at work"
                      : answering
                        ? "The Agent is answering"
                        : "A Run is at work"
                  }
                  onSelect={() => onSelect(session.id)}
                  onRename={(title) => onRename(session.id, title)}
                />
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">
            No Sessions yet. Start one and it will be listed here.
          </p>
        )}
      </div>
      {sessions ? (
        <p className="flex items-center gap-1.5 border-ink/10 border-t px-3 py-1.5 text-[0.7rem] text-stone">
          {sessions.length} of {LIMITS.sessionsPerWorkspace} Sessions
          {creating ? <Spinner /> : null}
        </p>
      ) : null}
    </nav>
  );
}
