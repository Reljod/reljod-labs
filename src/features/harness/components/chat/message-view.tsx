"use client";

import Link from "next/link";
import type { MessageView } from "../../domain/session";
import { formatCost } from "../api";
import type { LinkParams, TabId } from "../harness-context";
import { formatTokens } from "../pipelines/format";
import { Badge, cx, ErrorNote, Initials, Markdown, Spinner } from "../ui";
import { type ActivityItem, type AgentTurn, summarizeArgs } from "./chat-state";
import { RunCard } from "./run-card";

export type MessageActions = {
  openRun(runId: string): void;
  openTab(tab: TabId, params?: LinkParams): void;
  hrefFor(tab: TabId, params?: LinkParams): string;
};

// Staff ---------------------------------------------------------------------------

export function StaffMessage({
  message,
  text,
  name,
  initials,
  attachments,
  onPreview,
  pending = false,
}: {
  /** A saved message, or give `text` for one not saved yet. */
  message?: MessageView;
  text?: string;
  name: string;
  initials: string;
  attachments?: { name: string; sourceId?: string }[];
  /** Opens a saved attachment's Preview in the Knowledge tab. */
  onPreview?: (sourceId: string) => void;
  pending?: boolean;
}) {
  const body = message?.content ?? text ?? "";
  const files =
    attachments ??
    message?.parts.flatMap((part) =>
      part.type === "attachment"
        ? [{ name: part.name, sourceId: part.sourceId }]
        : [],
    ) ??
    [];
  return (
    <article
      aria-label={`${name} said`}
      className="flex items-start gap-2.5 sm:gap-3"
    >
      <Initials initials={initials} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink-muted">{name}</p>
        <p
          className={cx(
            "mt-0.5 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]",
            pending && "text-ink/80",
          )}
        >
          {body}
        </p>
        {files.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Attached">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <Badge className="max-w-72 normal-case tracking-normal">
                  <span aria-hidden="true">+</span>
                  <span className="truncate">{file.name}</span>
                  {file.sourceId && onPreview ? (
                    <button
                      type="button"
                      onClick={() => onPreview(file.sourceId as string)}
                      aria-label={`Preview ${file.name}`}
                      className="shrink-0 rounded-sm font-medium text-federal-blue underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-federal-blue"
                    >
                      Preview
                    </button>
                  ) : null}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

// Agent ---------------------------------------------------------------------------

function AgentMark() {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-sm border border-federal-blue bg-federal-blue font-mono text-[0.65rem] font-bold text-paper"
    >
      AI
    </span>
  );
}

function ToolLine({ item }: { item: Extract<ActivityItem, { type: "tool" }> }) {
  const args = summarizeArgs(item.args);
  const full = Object.keys(item.args).length
    ? JSON.stringify(item.args, null, 2)
    : "";
  return (
    <details className="group rounded-sm outline-box bg-paper text-xs open:bg-marble/50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-federal-blue [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="text-ink-muted transition-transform group-open:rotate-90"
        >
          ›
        </span>
        <span className="font-mono font-semibold">{item.name}</span>
        <span className="min-w-0 flex-1 truncate text-ink-muted">
          {args || item.summary}
        </span>
        {item.status === "running" ? (
          <span className="inline-flex items-center gap-1 text-federal-blue">
            <Spinner />
            <span className="sr-only">Running</span>
          </span>
        ) : (
          <Badge tone={item.status === "ok" ? "green" : "red"}>
            {item.status === "ok" ? "ok" : "failed"}
          </Badge>
        )}
      </summary>
      <div className="space-y-2 border-ink border-t-2 px-2.5 py-2">
        {item.summary ? (
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {item.summary}
          </p>
        ) : item.status === "running" ? (
          <p className="text-ink-muted">Waiting for the tool to answer…</p>
        ) : null}
        {full ? (
          <pre className="hx-scroll max-h-40 overflow-auto rounded-sm bg-ink/5 p-2 font-mono text-[0.7rem]">
            {full}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function Activity({
  item,
  actions,
}: {
  item: ActivityItem;
  actions: MessageActions;
}) {
  switch (item.type) {
    case "tool":
      return <ToolLine item={item} />;
    case "skill":
      return (
        <div>
          <Badge tone="blue" title={`Skill loaded: ${item.skillId}`}>
            Skill · {item.name}
          </Badge>
        </div>
      );
    case "run":
      return (
        <RunCard
          runId={item.runId}
          pipelineId={item.pipelineId}
          onView={actions.openRun}
        />
      );
    case "source":
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-sm outline-box bg-paper px-3 py-2 text-sm">
          <Badge tone="neutral">Source</Badge>
          <span className="min-w-0 flex-1 truncate font-medium">
            {item.title}
          </span>
          <button
            type="button"
            onClick={() =>
              actions.openTab("knowledge", {
                source: item.sourceId,
                preview: "original",
              })
            }
            aria-label={`Preview ${item.title}`}
            className="text-xs font-medium text-federal-blue underline underline-offset-2"
          >
            Preview
          </button>
          <Link
            href={actions.hrefFor("knowledge", { source: item.sourceId })}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              actions.openTab("knowledge", { source: item.sourceId });
            }}
            className="text-xs font-medium text-federal-blue underline underline-offset-2"
          >
            Open in Knowledge
          </Link>
        </div>
      );
    case "conflict":
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-sm outline-box bg-brass/20 px-3 py-2 text-sm">
          <Badge tone="amber">Conflict</Badge>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {item.summary}
          </span>
          <Link
            href={actions.hrefFor("knowledge", { conflict: item.conflictId })}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              actions.openTab("knowledge", { conflict: item.conflictId });
            }}
            className="text-xs font-medium text-federal-blue underline underline-offset-2"
          >
            Settle in Knowledge
          </Link>
        </div>
      );
  }
}

/** One Agent message: what it did, then what it said, then what it cost. Live or saved. */
export function AgentMessage({
  turn,
  actions,
  streaming = false,
  stopped = false,
  onRetry,
}: {
  turn: AgentTurn;
  actions: MessageActions;
  streaming?: boolean;
  stopped?: boolean;
  onRetry?: () => void;
}) {
  const hasContent = turn.text.length > 0;
  return (
    <article
      aria-label="The Agent said"
      aria-busy={streaming || undefined}
      className="flex items-start gap-2.5 sm:gap-3"
    >
      <AgentMark />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-semibold text-ink-muted">Agent</p>
        {turn.reasoning ? (
          <details className="rounded-sm border border-ink text-xs">
            <summary className="cursor-pointer px-2.5 py-1.5 text-ink-muted focus-visible:outline-2 focus-visible:outline-federal-blue">
              Thinking
            </summary>
            <p className="border-ink border-t-2 px-2.5 py-2 whitespace-pre-wrap text-ink-muted [overflow-wrap:anywhere]">
              {turn.reasoning}
            </p>
          </details>
        ) : null}
        {turn.activity.length > 0 ? (
          <div className="space-y-1.5">
            {turn.activity.map((item) => (
              <Activity
                key={`${item.type}-${
                  item.type === "tool"
                    ? item.id
                    : item.type === "skill"
                      ? item.skillId
                      : item.type === "run"
                        ? item.runId
                        : item.type === "source"
                          ? item.sourceId
                          : item.conflictId
                }`}
                item={item}
                actions={actions}
              />
            ))}
          </div>
        ) : null}
        {hasContent ? <Markdown text={turn.text} /> : null}
        {streaming && !hasContent && turn.activity.length === 0 ? (
          <p className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Thinking…
          </p>
        ) : null}
        {streaming && hasContent ? (
          <span
            aria-hidden="true"
            className="hx-pulse inline-block h-4 w-1.5 bg-ink/60 align-middle"
          />
        ) : null}
        {stopped ? (
          <p className="text-xs text-ink-muted">Stopped before it finished.</p>
        ) : null}
        {turn.error ? (
          <ErrorNote onRetry={onRetry}>{turn.error}</ErrorNote>
        ) : null}
        {turn.usage ? (
          <p className="font-mono text-[0.68rem] text-ink-muted">
            {turn.usage.model} · {formatTokens(turn.usage.inputTokens)} in ·{" "}
            {formatTokens(turn.usage.outputTokens)} out ·{" "}
            {formatCost(turn.usage.costUsd)}
          </p>
        ) : null}
      </div>
    </article>
  );
}
