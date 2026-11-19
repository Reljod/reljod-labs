"use client";

import type { ReactNode } from "react";
import type { MessagePart } from "../domain/chat";
import { cx } from "./ui";

/*
 * What the canvas shows when it has no View yet: an explainer that plays
 * the idea in three panes; and while the Analyst works: a drafting table
 * that names each step as it happens. Motion is CSS (canvas.css).
 */

function Pane({
  n,
  title,
  children,
  caption,
}: {
  n: number;
  title: string;
  children: ReactNode;
  caption: ReactNode;
}) {
  return (
    <li className="cv-step flex min-w-0 flex-col">
      <div className="outline-box flex min-h-0 flex-1 flex-col rounded-sm bg-paper shadow-hard-sm">
        <p className="flex items-center gap-2 border-ink border-b-2 px-3 py-1.5">
          <span className="grid size-5 shrink-0 place-items-center bg-ink font-mono text-[0.65rem] font-bold text-paper">
            {n}
          </span>
          <span className="eyebrow truncate text-[0.68rem] font-bold">
            {title}
          </span>
        </p>
        <div className="relative h-28 overflow-hidden px-3 py-3">
          {children}
        </div>
      </div>
      <p className="mt-2 text-sm leading-snug text-ink-muted">{caption}</p>
    </li>
  );
}

/** The empty canvas: what Canvas is, played in three panes. */
export function Explainer({ onTry }: { onTry?: () => void }) {
  return (
    <div
      className="cv-explain outline-box rounded-sm p-5 shadow-hard-md sm:p-8"
      data-testid="canvas-explainer"
    >
      <p className="eyebrow text-[0.7rem] font-bold text-federal-blue">
        The canvas · empty for now
      </p>
      <h2 className="mt-2 max-w-2xl font-mono text-2xl leading-tight font-bold tracking-tight text-balance uppercase sm:text-3xl">
        Ask a question.
        <br />
        Get back something you can{" "}
        <span className="bg-brass px-1 text-ink">use</span>, not a paragraph.
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
        The Analyst reads about a million rows of Meridia&apos;s open data the
        only way it can: by writing queries that run in a locked-down sandbox.
        What comes back lands here as a View, a live chart with the working
        shown.
      </p>

      <ol className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-3">
        <Pane
          n={1}
          title="You ask"
          caption="In plain words. Or pick one of the starters on the left."
        >
          <p className="font-mono text-[0.72rem] text-ink-muted uppercase">
            Question
          </p>
          <p className="mt-1 text-sm font-semibold">
            <span className="cv-type">Did the heatwave lift peak load?</span>
            <span className="cv-caret" aria-hidden="true" />
          </p>
          <p className="mt-3 flex flex-wrap gap-1.5">
            {["grid_load", "weather"].map((table) => (
              <span
                key={table}
                className="border border-ink bg-morning-haze px-1.5 font-mono text-[0.62rem] font-bold"
              >
                {table}
              </span>
            ))}
          </p>
        </Pane>

        <Pane
          n={2}
          title="It queries"
          caption={
            <>
              SQL in a sandbox with no network. A guard reads every query first:
              private columns only ever come back{" "}
              <strong className="text-ink">aggregated</strong>.
            </>
          }
        >
          <div className="cv-rows relative">
            <span className="cv-sweep" aria-hidden="true" />
            {[100, 86, 94, 72, 90, 80].map((width, index) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: decorative rows.
                key={index}
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
          <p className="mt-3 font-mono text-[0.62rem] text-ink-muted">
            70,080 rows → <span className="font-bold text-ink">28</span>
          </p>
        </Pane>

        <Pane
          n={3}
          title="A View lands"
          caption={
            <>
              Drag its control and the query runs again,{" "}
              <strong className="text-ink">no model call</strong>. Code
              re-checks every number before it says Verified.
            </>
          }
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-2">
              <span className="h-1.5 w-1/2 bg-ink/25" />
              <span className="cv-stamp border-2 border-ivy px-1 font-mono text-[0.58rem] font-bold tracking-wider text-ivy uppercase">
                ✓ Verified
              </span>
            </div>
            <div className="cv-bars mt-2 min-h-0 flex-1">
              {[45, 52, 48, 95, 100, 58, 50].map((height, index) => (
                <i
                  // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars.
                  key={index}
                  className={index === 3 || index === 4 ? "hot" : undefined}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
            <div className="relative mt-2 h-0.5 bg-ink/30">
              {/* The track moves, not the knob: 60% of the track's width. */}
              <span className="cv-knob absolute inset-0" aria-hidden="true">
                <span className="absolute top-1/2 left-[10%] block size-2.5 -translate-y-1/2 border-2 border-ink bg-paper" />
              </span>
            </div>
          </div>
        </Pane>
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-ink/20 border-t pt-4 text-xs text-ink-muted">
        <span className="font-mono font-bold text-ink uppercase">
          Same view, inside Claude
        </span>
        <span>
          Each View is an MCP App. Connect Claude to this server and it shows
          the very same interface.
        </span>
        {onTry ? (
          <button
            type="button"
            onClick={onTry}
            className="outline-box press ml-auto rounded-sm bg-federal-blue px-3 py-1.5 font-mono text-[0.7rem] font-bold tracking-[0.08em] text-paper uppercase"
          >
            Try a starter →
          </button>
        ) : null}
      </div>
    </div>
  );
}

const STEP_WORDS: Record<string, string> = {
  list_tables: "Reading the Catalog",
  describe_table: "Reading a Table's columns",
  run_query: "Querying in the Sandbox",
  run_code: "Running code in the Sandbox",
  create_view: "Drawing a View, checking its numbers",
  load_skill: "Loading a Skill",
  get_rules: "Reading the Rules",
  list_views: "Looking at the Views so far",
  show_view: "Opening a View",
};

type Tool = Extract<MessagePart, { type: "tool" }>;

/** The canvas while the Analyst works: what it is doing, step by step. */
export function Working({
  parts,
  building,
  compact = false,
}: {
  parts: MessagePart[];
  /** The title of a View being written, as it streams. */
  building: string | null;
  /** A strip above Views already on the canvas, not a full panel. */
  compact?: boolean;
}) {
  const tools = parts.filter((part): part is Tool => part.type === "tool");
  const current = [...tools]
    .reverse()
    .find((tool) => tool.ms === 0 && !tool.ok);
  const headline = building
    ? `Drawing “${building}”`
    : current
      ? (STEP_WORDS[current.name] ?? current.name)
      : tools.length === 0
        ? "Reading your question"
        : "Thinking about what it found";
  const recent = tools.slice(-4);
  return (
    <div
      className={cx(
        "outline-box relative overflow-hidden rounded-sm bg-paper shadow-hard-sm",
        compact ? "p-3" : "p-5",
      )}
      data-testid="canvas-working"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="cv-work-scan" aria-hidden="true" />
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          <span className="size-2 animate-pulse bg-federal-blue" />
          <span className="eyebrow text-[0.68rem] font-bold text-federal-blue">
            The Analyst is working
          </span>
        </span>
        <span className="font-mono text-[0.68rem] text-ink-muted">
          {tools.length} step{tools.length === 1 ? "" : "s"}
        </span>
      </div>
      <p
        className={cx(
          "relative mt-1 font-semibold text-balance",
          compact ? "text-sm" : "text-lg",
        )}
      >
        {headline}…
      </p>
      {compact ? null : (
        <>
          <ol className="relative mt-3 space-y-1">
            {recent.map((tool) => (
              <li
                key={tool.id}
                className="cv-step-in flex min-w-0 items-center gap-2 text-xs"
              >
                <span
                  className={cx(
                    "size-1.5 shrink-0",
                    tool.ms === 0 && !tool.ok
                      ? "animate-pulse bg-brass"
                      : tool.ok
                        ? "bg-ivy"
                        : "bg-seal-red",
                  )}
                />
                <span className="shrink-0 font-mono font-bold">
                  {tool.name}
                </span>
                <span className="min-w-0 truncate text-ink-muted">
                  {tool.ms === 0 && !tool.ok
                    ? typeof tool.args.purpose === "string"
                      ? tool.args.purpose
                      : "running…"
                    : tool.summary}
                </span>
              </li>
            ))}
          </ol>
          <div
            className="cv-work-bars relative mt-4 flex h-24 items-end gap-2 border-ink/25 border-b"
            aria-hidden="true"
          >
            {[40, 62, 35, 78, 55, 90, 66, 48, 72, 58, 44, 69].map(
              (height, index) => (
                <i
                  // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars.
                  key={index}
                  style={{
                    height: `${height}%`,
                    animationDelay: `${index * 90}ms`,
                  }}
                />
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
