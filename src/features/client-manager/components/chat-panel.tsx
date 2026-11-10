"use client";

import {
  type DragEvent,
  type FormEvent,
  Fragment,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { type BuildState, spendOf } from "../domain/build-state";
import { splitCitations } from "../domain/citations";
import {
  JOB_LABELS,
  JOBS,
  type JobId,
  MAX_MESSAGE_LENGTH,
  type ToolName,
  type TraversalStep,
} from "../domain/events";
import { type AppliedRepair, describeRepair } from "../domain/graph";
import { describeStep } from "../domain/traversal";
import type { ClientView, MessageView } from "../server/service";
import { filesFromDrop } from "./sample-files";
import { ACCEPT, formatBytes } from "./upload";

/**
 * The Navigator's chat, in the Casework desk's transcript style: the person's
 * lines after ❯, every tool call as a ● line with its ⎿ result, reasoning
 * folded away, numbered choices, a card per Build, and one composer that
 * takes words and files.
 */

export type TraceEntry = { step: TraversalStep; sql: string; ms: number };

export type ToolLineState = {
  callId: string;
  name: ToolName;
  input: unknown;
  ok?: boolean;
  summary?: string;
  entry?: TraceEntry;
};

export type AskState = {
  question: string;
  tools: ToolLineState[];
  reasoning: string;
  text: string;
  done: boolean;
  error: string | null;
  costUsd: number | null;
  buildId: string | null;
  startedAt: number;
};

export type Working = { label: string; costUsd: number; since: number } | null;

type Props = {
  view: ClientView;
  live: BuildState | null;
  liveBuildId: string | null;
  asking: AskState | null;
  working: Working;
  labelOf: (key: string) => string;
  toneFor: (key: string) => string;
  onSend: (text: string, files: File[]) => void;
  onStop: () => void;
  onReplay: (steps: TraversalStep[]) => void;
  onCite: (key: string) => void;
  onHover: (key: string | null) => void;
};

const TOOL_TITLE: Record<ToolName, string> = {
  search_graph: "Search graph",
  expand: "Expand",
  connect: "Connect",
  browse_category: "Browse category",
  read: "Read",
  record_facts: "Record facts",
};

const STEP_TOOL: Record<TraversalStep["kind"], ToolName> = {
  search: "search_graph",
  expand: "expand",
  path: "connect",
  category: "browse_category",
  read: "read",
};

function toolArgs(
  name: ToolName,
  input: unknown,
  labelOf: (key: string) => string,
) {
  if (!input || typeof input !== "object") return "";
  const args = input as Record<string, unknown>;
  switch (name) {
    case "search_graph":
      return typeof args.query === "string" ? `"${args.query}"` : "";
    case "expand":
      return Array.isArray(args.keys)
        ? `${args.keys
            .map((key) => labelOf(String(key)))
            .slice(0, 2)
            .join(
              ", ",
            )}${args.keys.length > 2 ? ` +${args.keys.length - 2}` : ""}, ${args.hops} hop${args.hops === 1 ? "" : "s"}`
        : "";
    case "connect":
      return `${labelOf(String(args.from ?? ""))} → ${labelOf(String(args.to ?? ""))}`;
    case "browse_category":
      return String(args.category ?? "");
    case "read":
      return Array.isArray(args.keys)
        ? `${args.keys.length} node${args.keys.length === 1 ? "" : "s"}`
        : "";
    case "record_facts":
      return typeof args.facts === "string"
        ? `"${args.facts.slice(0, 48)}${args.facts.length > 48 ? "…" : ""}"`
        : "";
  }
}

/** Arguments for a stored step, whose call input wasn't kept. */
function stepArgs(step: TraversalStep, labelOf: (key: string) => string) {
  switch (step.kind) {
    case "search":
      return `"${step.query}"`;
    case "expand":
      return `${step.from.map(labelOf).slice(0, 2).join(", ")}${step.from.length > 2 ? ` +${step.from.length - 2}` : ""}, ${step.hops} hop${step.hops === 1 ? "" : "s"}`;
    case "path":
      return `${labelOf(step.from)} → ${labelOf(step.to)}`;
    case "category":
      return step.category;
    case "read":
      return `${step.keys.length} node${step.keys.length === 1 ? "" : "s"}`;
  }
}

/** Bold and code spans only; the Navigator writes short plain replies. */
function rich(text: string, key: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    const id = `${key}-${index}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={id}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={id}
          className="rounded-[2px] bg-limestone/60 px-1 font-mono text-[0.92em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={id}>{part}</Fragment>;
  });
}

function seconds(value: number) {
  const whole = Math.round(value);
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

export function ChatPanel(props: Props) {
  const { view, live, liveBuildId, asking, working } = props;
  const [text, setText] = useState("");
  const [tray, setTray] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const busy = !!asking && !asking.done;
  const ready = view.graph.nodes.length > 1;

  const tail = `${view.messages.length}-${asking?.text.length ?? 0}-${asking?.tools.length ?? 0}-${live?.received ?? 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new and growing messages
  useEffect(() => {
    list.current?.scrollTo({
      top: list.current.scrollHeight,
      behavior: "smooth",
    });
  }, [tail]);

  // Escape stops whatever is going, unless a dialog has it.
  const { onStop } = props;
  const stoppable = !!working;
  useEffect(() => {
    if (!stoppable) return;
    const stop = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      onStop();
    };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [stoppable, onStop]);

  const addFiles = (files: File[]) =>
    setTray((current) => [...current, ...files].slice(0, 8));

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (busy) return;
    if (tray.length > 0) {
      if (!view.canAdd) return;
      props.onSend(value, tray);
    } else {
      if (!value || !ready) return;
      props.onSend(value, []);
    }
    setText("");
    setTray([]);
  }

  const asked =
    view.messages.some((message) => message.mode === "ask") || !!asking;
  const starters = view.persona?.questions?.length
    ? view.persona.questions.map((question) => ({
        label: question,
        detail: "",
      }))
    : [
        {
          label: "Who matters most in their life?",
          detail: "Walks Family & network",
        },
        {
          label: "What do they own, and where is it held?",
          detail: "Opens the Wealth branch",
        },
        {
          label: "What should I raise on my next call?",
          detail: "Goals, concerns and upcoming events",
        },
      ];

  const placedLive = liveBuildId
    ? view.messages.some((message) => message.buildId === liveBuildId) ||
      asking?.buildId === liveBuildId
    : true;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!view.canAdd) return;
    void filesFromDrop(event.dataTransfer).then(addFiles);
  };

  return (
    <section
      aria-label="Chat with the Navigator"
      className="cm-droppable relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper"
      data-over={over}
      onDragOver={(event) => {
        if (!view.canAdd) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={onDrop}
    >
      <header className="flex items-center gap-2.5 border-ink border-b-2 bg-ink px-3 py-2.5 text-paper">
        <span
          className={`size-2.5 rounded-full ${working ? "cm-pulse bg-brass" : "bg-[#7fd38f]"}`}
        />
        <p className="font-mono text-sm font-bold tracking-[0.1em] uppercase">
          Navigator
        </p>
        <span
          className="ml-auto truncate rounded-sm border border-paper/30 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em] text-paper/80"
          title="The model that walks the graph"
        >
          {view.chatModel} · pgRouting
        </span>
      </header>

      <div
        ref={list}
        aria-live="polite"
        className="cm-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-[13.5px] leading-relaxed"
      >
        {view.messages.map((message) => (
          <Message key={message.id} message={message} {...props} />
        ))}
        {!placedLive && live && liveBuildId ? (
          <BuildRunCard
            state={live}
            trigger={view.latestBuild?.trigger ?? "intake"}
            canStop={view.canAdd}
            onStop={props.onStop}
          />
        ) : null}

        {asking ? (
          <>
            <UserLine text={asking.question} files={[]} />
            <NavigatorTurn
              reasoning={asking.reasoning}
              tools={asking.tools}
              text={asking.text}
              pending={!asking.done}
              error={asking.error}
              costUsd={asking.costUsd}
              build={
                asking.buildId && asking.buildId === liveBuildId && live ? (
                  <BuildRunCard
                    state={live}
                    trigger="addition"
                    canStop={view.canAdd}
                    onStop={props.onStop}
                  />
                ) : null
              }
              {...props}
            />
          </>
        ) : null}

        {!asked && ready && !working ? (
          <div className="cm-reveal">
            <p className="font-mono text-[11px] tracking-[0.1em] text-federal-blue uppercase">
              ✻ The graph is ready
            </p>
            <p className="mt-2 font-mono text-lg leading-tight font-bold">
              Ask about {view.name.split(" ")[0]}, or tell me something new.
            </p>
            <p className="mt-2 text-ink-muted">
              I answer by walking the graph in Postgres, and you can watch the
              walk on the left. New facts and dropped files go through the same
              self-correcting pipeline.
            </p>
            <Choices
              question="Try one"
              options={starters}
              disabled={busy}
              onPick={(label) => props.onSend(label, [])}
            />
          </div>
        ) : null}
      </div>

      {working ? <WorkingLine {...working} onStop={props.onStop} /> : null}

      <form onSubmit={submit} className="border-ink border-t-2 bg-marble/50">
        {tray.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {tray.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="cm-reveal flex max-w-48 items-center gap-1 rounded-sm border border-ink/40 bg-paper py-0.5 pr-0.5 pl-1.5 text-xs"
              >
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-stone">
                  {formatBytes(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setTray(tray.filter((_, item) => item !== index))
                  }
                  className="px-1 font-mono font-bold text-ink-muted hover:text-seal-red"
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-start gap-2 px-3 pt-2.5">
          <span
            className="pt-[7px] font-mono text-sm font-bold text-federal-blue"
            aria-hidden="true"
          >
            ❯
          </span>
          <label htmlFor="cm-input" className="sr-only">
            Message the Navigator
          </label>
          <textarea
            id="cm-input"
            value={text}
            rows={Math.min(5, Math.max(1, text.split("\n").length))}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              over
                ? "Drop it here"
                : tray.length
                  ? "Add a note about these files, or just press Enter"
                  : ready
                    ? "Ask, or share an update"
                    : "The graph is still building…"
            }
            className="min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 font-mono text-[13px] leading-relaxed placeholder:text-stone focus:outline-none"
          />
          {view.canAdd ? (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                className="press mt-0.5 h-8 rounded-sm border-2 border-ink bg-paper px-2 font-mono text-[11px] font-bold tracking-[0.08em] uppercase"
                title="Attach files"
              >
                Files
              </button>
            </>
          ) : null}
          {working ? (
            <button
              type="button"
              onClick={props.onStop}
              className="press mt-0.5 flex h-8 items-center gap-1.5 rounded-sm border-2 border-ink bg-seal-red px-2.5 font-mono text-[11px] font-bold tracking-[0.08em] text-paper uppercase"
            >
              <span className="size-2 bg-paper" aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy || (tray.length === 0 && (!text.trim() || !ready))}
              className="press mt-0.5 h-8 rounded-sm border-2 border-ink bg-federal-blue px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-paper uppercase disabled:opacity-35"
            >
              Send
            </button>
          )}
        </div>
        <p className="px-3 pt-1 pb-2 font-mono text-[10px] tracking-[0.02em] text-stone">
          enter to send · shift+enter for a new line
          {view.canAdd
            ? " · drop files to add them"
            : " · sample clients are read-only"}
          {working ? " · esc to stop" : ""}
        </p>
      </form>
    </section>
  );
}

function UserLine({ text, files }: { text: string; files: string[] }) {
  return (
    <div className="cm-reveal rounded-sm border-l-[3px] border-federal-blue bg-morning-haze/50 py-2 pr-3 pl-3">
      <p className="flex gap-2 font-mono text-[13px]">
        <span className="font-bold text-federal-blue" aria-hidden="true">
          ❯
        </span>
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {text || <span className="text-ink-muted">(files, no note)</span>}
        </span>
      </p>
      {files.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-5">
          {files.map((name) => (
            <span
              key={name}
              className="max-w-44 truncate rounded-sm border border-ink/30 bg-paper px-1.5 py-0.5 text-[11px]"
            >
              {name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Message({ message, ...props }: Props & { message: MessageView }) {
  const { live, liveBuildId, view } = props;
  if (message.role === "user") {
    // A Build's own line lists its files after a paperclip.
    const lines = message.content.split("\n");
    const files = lines
      .filter((line) => line.startsWith("📎 "))
      .flatMap((line) =>
        line
          .slice(2)
          .split(", ")
          .map((name) => name.trim()),
      );
    const words = lines.filter((line) => !line.startsWith("📎 ")).join("\n");
    return (
      <>
        <UserLine text={words} files={files} />
        {message.buildId && message.buildId === liveBuildId && live ? (
          <BuildRunCard
            state={live}
            trigger={view.latestBuild?.trigger ?? "intake"}
            canStop={view.canAdd}
            onStop={props.onStop}
          />
        ) : null}
      </>
    );
  }
  if (message.mode === "build") {
    if (message.buildId === liveBuildId) return null;
    return (
      <BuildSummaryCard
        text={message.content}
        repairs={view.repairs.filter(
          (repair) => repair.buildId === message.buildId,
        )}
      />
    );
  }
  const steps = message.traversal?.steps ?? [];
  return (
    <NavigatorTurn
      reasoning={message.traversal?.reasoning ?? ""}
      tools={steps.map((entry, index) => ({
        callId: `${message.id}-${index}`,
        name: STEP_TOOL[entry.step.kind],
        input: null,
        ok: true,
        entry,
      }))}
      text={message.content}
      pending={false}
      error={null}
      costUsd={null}
      build={
        message.buildId && message.buildId === liveBuildId && live ? (
          <BuildRunCard
            state={live}
            trigger="addition"
            canStop={view.canAdd}
            onStop={props.onStop}
          />
        ) : null
      }
      {...props}
    />
  );
}

function NavigatorTurn({
  reasoning,
  tools,
  text,
  pending,
  error,
  costUsd,
  build,
  labelOf,
  toneFor,
  onReplay,
  onCite,
  onHover,
}: Props & {
  reasoning: string;
  tools: ToolLineState[];
  text: string;
  pending: boolean;
  error: string | null;
  costUsd: number | null;
  build: ReactNode;
}) {
  const [thinking, setThinking] = useState(false);
  const steps = tools.flatMap((tool) => (tool.entry ? [tool.entry.step] : []));
  const parts = splitCitations(text);
  return (
    <div className="cm-reveal grid gap-2">
      {reasoning.trim() ? (
        <div>
          <button
            type="button"
            onClick={() => setThinking(!thinking)}
            aria-expanded={thinking}
            className="font-mono text-[11px] text-stone italic hover:text-ink-muted"
          >
            ∴ {pending && !text ? "Thinking" : "Thought"} for a moment{" "}
            {thinking ? "▾" : "▸"}
          </button>
          {thinking ? (
            <p className="mt-1 border-ink/15 border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-ink-muted italic">
              {reasoning.trim()}
            </p>
          ) : null}
        </div>
      ) : null}

      {tools.map((tool) => (
        <ToolLine
          key={tool.callId}
          tool={tool}
          running={pending && tool.ok === undefined}
          labelOf={labelOf}
        />
      ))}

      {text || error ? (
        <div className="flex gap-2">
          <span className="font-mono text-ink" aria-hidden="true">
            ●
          </span>
          <div className="min-w-0 break-words whitespace-pre-wrap">
            {error ? <span className="text-seal-red">{error} </span> : null}
            {parts.map((part, index) =>
              part.kind === "text" ? (
                <Fragment key={`t${index}-${part.text.slice(0, 12)}`}>
                  {rich(part.text, String(index))}
                </Fragment>
              ) : (
                <button
                  key={`c${index}-${part.key}`}
                  type="button"
                  onClick={() => onCite(part.key)}
                  onMouseEnter={() => onHover(part.key)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(part.key)}
                  onBlur={() => onHover(null)}
                  className="mx-0.5 inline-flex max-w-[13rem] translate-y-[-1px] items-center gap-1 rounded-sm border border-ink/50 bg-paper px-1.5 align-middle font-mono text-[10.5px] font-bold hover:border-ink hover:bg-morning-haze"
                  title="Show on the graph"
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: toneFor(part.key) }}
                  />
                  <span className="truncate">{labelOf(part.key)}</span>
                </button>
              ),
            )}
            {pending ? (
              <span className="cm-pulse ml-0.5 font-mono text-federal-blue">
                ▍
              </span>
            ) : null}
          </div>
        </div>
      ) : pending ? (
        <output
          className="cm-text-shimmer font-mono text-xs"
          aria-label="The Navigator is thinking"
        >
          ✻ {tools.length > 0 ? "Walking the graph…" : "Thinking…"}
        </output>
      ) : null}

      {build}

      {!pending && steps.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 font-mono text-[10.5px] text-stone">
          <button
            type="button"
            onClick={() => onReplay(steps)}
            className="font-bold text-federal-blue underline"
          >
            ▶ Replay the walk
          </button>
          <span>
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </span>
          {costUsd !== null ? <span>${costUsd.toFixed(4)}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function ToolLine({
  tool,
  running,
  labelOf,
}: {
  tool: ToolLineState;
  running: boolean;
  labelOf: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const args = tool.input
    ? toolArgs(tool.name, tool.input, labelOf)
    : tool.entry
      ? stepArgs(tool.entry.step, labelOf)
      : "";
  const tone =
    tool.ok === false
      ? "text-seal-red"
      : running
        ? "cm-pulse text-brass"
        : "text-ivy";
  const result = running
    ? "Running…"
    : tool.entry
      ? describeStep(tool.entry.step, labelOf).detail
      : (tool.summary ?? "");
  return (
    <div
      className="font-mono text-xs"
      data-testid="tool-line"
      data-tool={tool.name}
    >
      <button
        type="button"
        disabled={!tool.entry}
        onClick={() => setOpen(!open)}
        aria-expanded={tool.entry ? open : undefined}
        className="flex w-full gap-2 text-left enabled:hover:text-federal-blue"
        title={tool.entry ? "Show the SQL" : undefined}
      >
        <span className={tone} aria-hidden="true">
          ●
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-bold">{TOOL_TITLE[tool.name]}</span>
          {args ? <span className="text-ink-muted">({args})</span> : null}
        </span>
        {tool.entry ? (
          <span className="shrink-0 text-[10px] text-stone">
            {tool.entry.ms}ms {open ? "▾" : "▸"}
          </span>
        ) : null}
      </button>
      {result ? (
        <p className="flex gap-2 pl-[3px] text-ink-muted">
          <span aria-hidden="true">⎿</span>
          <span
            className={`min-w-0 break-words ${tool.ok === false ? "text-seal-red" : ""}`}
          >
            {result}
          </span>
        </p>
      ) : null}
      {open && tool.entry ? (
        <pre className="cm-reveal mt-1.5 ml-5 overflow-x-auto rounded-sm bg-ink p-2 text-[10.5px] leading-relaxed text-morning-haze">
          {tool.entry.sql}
        </pre>
      ) : null}
    </div>
  );
}

/** Options as numbered buttons; the pick goes back as the person's next message. */
function Choices({
  question,
  options,
  disabled,
  onPick,
}: {
  question: string;
  options: { label: string; detail: string }[];
  disabled: boolean;
  onPick: (label: string) => void;
}) {
  return (
    <div className="cm-reveal mt-3 rounded-sm border-2 border-ink bg-paper">
      <p className="border-ink/15 border-b px-3 py-2 font-mono text-xs font-bold">
        {question}
      </p>
      <ol className="grid">
        {options.map((option, index) => (
          <li key={option.label}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(option.label)}
              className="group flex w-full items-baseline gap-2 border-ink/10 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-morning-haze/60 focus-visible:bg-morning-haze/60 focus-visible:outline-none disabled:opacity-50"
            >
              <span className="font-mono text-xs text-federal-blue opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                ❯
              </span>
              <span className="font-mono text-xs text-ink-muted">
                {index + 1}.
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">
                  {option.label}
                </span>
                {option.detail ? (
                  <span className="block text-xs text-ink-muted">
                    {option.detail}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="border-ink/15 border-t px-3 py-1.5 font-mono text-[10px] text-stone">
        or type something else below
      </p>
    </div>
  );
}

const REPAIR_GLYPH: Record<
  AppliedRepair["op"],
  { glyph: string; tone: string }
> = {
  remove_node: { glyph: "✕", tone: "#b23a2b" },
  merge_nodes: { glyph: "⇄", tone: "#1d4e89" },
  move_node: { glyph: "↪", tone: "#6b4226" },
  update_node: { glyph: "✎", tone: "#4a4f5b" },
  resolve_conflict: { glyph: "⚖", tone: "#b38327" },
  add_edge: { glyph: "+", tone: "#2f6b3f" },
  remove_edge: { glyph: "−", tone: "#b23a2b" },
};

const BUILD_STATUS = {
  running: { label: "Running", tone: "text-federal-blue" },
  completed: { label: "Done", tone: "text-ivy" },
  failed: { label: "Failed", tone: "text-seal-red" },
  stopped: { label: "Stopped", tone: "text-seal-red" },
} as const;

/** A live Build in the transcript: every Job as a tool line, every Repair under it, cost below. */
export function BuildRunCard({
  state,
  trigger,
  canStop,
  onStop,
}: {
  state: BuildState;
  trigger: "intake" | "addition";
  canStop: boolean;
  onStop: () => void;
}) {
  const spend = spendOf(state);
  const status = state.end?.status ?? "running";
  const over = status !== "running";
  const rounds = Math.max(1, ...state.runs.map((run) => run.round));
  const track: { job: JobId; round: number }[] = [];
  for (const job of JOBS) {
    if (job === "check" || job === "critique" || job === "repair") continue;
    track.push({ job, round: 0 });
    if (job === "extract") {
      for (let round = 1; round <= rounds; round++) {
        track.push(
          { job: "check", round },
          { job: "critique", round },
          { job: "repair", round },
        );
      }
    }
  }
  const started = state.runs[0]?.startedAt;
  const finished = state.runs.at(-1);
  const elapsed =
    started && finished
      ? (finished.startedAt + (finished.ms ?? 0) - started) / 1000
      : 0;

  return (
    <div
      className="cm-reveal rounded-sm border-2 border-ink bg-paper shadow-hard-sm"
      data-testid="build-card"
      data-status={status}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={`size-2 shrink-0 rounded-full bg-current ${BUILD_STATUS[status].tone} ${over ? "" : "cm-pulse"}`}
        />
        <p className="min-w-0 flex-1 truncate font-mono text-xs font-bold tracking-[0.04em] uppercase">
          Graph build · {trigger === "intake" ? "Intake" : "Addition"}
        </p>
        <span
          className={`shrink-0 font-mono text-[10px] font-bold tracking-[0.06em] uppercase ${BUILD_STATUS[status].tone}`}
        >
          {BUILD_STATUS[status].label}
        </span>
      </div>
      <div className="grid gap-1.5 border-ink/10 border-t px-3 py-2.5 font-mono text-xs">
        {track.map(({ job, round }) => {
          const run = state.runs.find(
            (item) => item.job === job && item.round === round,
          );
          if (!run && over) return null;
          const running = run?.state === "start";
          const tone = !run
            ? "text-stone/50"
            : run.state === "error"
              ? "text-seal-red"
              : running
                ? "cm-pulse text-brass"
                : "text-ivy";
          const repairs =
            job === "repair" || job === "check"
              ? state.repairs.filter(
                  (item) =>
                    item.round === round &&
                    item.repair.by === (job === "check" ? "check" : "critic"),
                )
              : [];
          return (
            <div key={`${job}-${round}`}>
              <p className="flex gap-2">
                <span className={tone} aria-hidden="true">
                  ●
                </span>
                <span className={`min-w-0 flex-1 ${run ? "" : "text-stone"}`}>
                  <span className="font-bold">{JOB_LABELS[job].title}</span>
                  {round > 0 ? (
                    <span className="text-ink-muted">(round {round})</span>
                  ) : null}
                </span>
                {run?.ms !== undefined ? (
                  <span className="shrink-0 text-[10px] text-stone">
                    {(run.ms / 1000).toFixed(1)}s
                  </span>
                ) : null}
              </p>
              {run ? (
                <p className="flex gap-2 pl-[3px] text-ink-muted">
                  <span aria-hidden="true">⎿</span>
                  <span
                    className={`min-w-0 break-words ${running ? "cm-text-shimmer" : ""}`}
                  >
                    {running
                      ? `${JOB_LABELS[job].verb}…`
                      : (run.detail ?? JOB_LABELS[job].verb)}
                  </span>
                </p>
              ) : null}
              {repairs.length > 0 ? (
                <ul className="mt-0.5 ml-5 grid gap-0.5">
                  {repairs.map(({ repair, at }, index) => {
                    const glyph = REPAIR_GLYPH[repair.op];
                    return (
                      <li
                        key={`${at}-${index}-${describeRepair(repair)}`}
                        className="cm-reveal flex gap-2 text-[11px]"
                      >
                        <span
                          className="font-bold"
                          style={{ color: glyph.tone }}
                          aria-hidden="true"
                        >
                          {glyph.glyph}
                        </span>
                        <span className="min-w-0 font-sans text-ink">
                          {repair.reason || describeRepair(repair)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      {state.persona ? (
        <p className="border-ink/10 border-t px-3 py-2 text-[13px]">
          <span className="font-mono text-[11px] font-bold tracking-[0.06em] text-federal-blue uppercase">
            {state.persona.archetype}
          </span>{" "}
          · {state.persona.headline}
        </p>
      ) : null}
      {state.end?.status === "failed" ? (
        <p className="border-ink/10 border-t px-3 py-2 text-[13px] text-seal-red">
          {state.end.error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-ink/10 border-t bg-marble/50 px-3 py-1.5 font-mono text-[11px] text-ink-muted">
        <span>
          {over ? "Cost" : "So far"}{" "}
          <span className="font-bold text-ink">
            ${spend.costUsd.toFixed(4)}
          </span>
        </span>
        <span>
          {state.usages.length} call{state.usages.length === 1 ? "" : "s"}
        </span>
        <span>
          {state.graph.nodes.length} nodes · {state.graph.edges.length} edges
        </span>
        {elapsed > 0 ? <span>{seconds(elapsed)}</span> : null}
        <span>
          {state.repairs.length} self-correction
          {state.repairs.length === 1 ? "" : "s"}
        </span>
        {!over && canStop ? (
          <button
            type="button"
            onClick={onStop}
            className="ml-auto font-bold text-seal-red underline"
          >
            Stop
          </button>
        ) : null}
      </div>
      {state.logs.length > 0 ? (
        <details className="border-ink/10 border-t">
          <summary className="cursor-pointer px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.06em] text-ink-muted uppercase">
            Run log · {state.logs.length}
          </summary>
          <pre className="cm-scroll max-h-40 overflow-y-auto bg-ink px-3 py-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-morning-haze">
            {state.logs
              .map(
                (log) =>
                  `${log.level === "info" ? "·" : log.level === "warn" ? "!" : "✗"} ${log.text}`,
              )
              .join("\n")}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

/** A finished Build from before this page opened: its summary and what it corrected. */
function BuildSummaryCard({
  text,
  repairs,
}: {
  text: string;
  repairs: ClientView["repairs"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cm-reveal rounded-sm border-2 border-ink/40 bg-paper">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="size-2 shrink-0 rounded-full bg-ivy" />
        <p className="min-w-0 flex-1 truncate font-mono text-xs font-bold tracking-[0.04em] uppercase">
          Graph build
        </p>
        <span className="font-mono text-[10px] font-bold tracking-[0.06em] text-ivy uppercase">
          Done
        </span>
      </div>
      <p className="border-ink/10 border-t px-3 py-2 text-[13px]">{text}</p>
      {repairs.length > 0 ? (
        <div className="border-ink/10 border-t bg-marble/50 px-3 py-1.5 font-mono text-[11px]">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="font-bold text-federal-blue underline"
          >
            {open ? "Hide" : "Show"} {repairs.length} self-correction
            {repairs.length === 1 ? "" : "s"}
          </button>
          {open ? (
            <ul className="mt-1.5 grid gap-0.5">
              {repairs.map((repair, index) => {
                const glyph =
                  REPAIR_GLYPH[repair.op as AppliedRepair["op"]] ??
                  REPAIR_GLYPH.update_node;
                return (
                  <li
                    key={`${repair.round}-${repair.op}-${index}-${repair.detail.reason ?? ""}`}
                    className="flex gap-2"
                  >
                    <span
                      className="font-bold"
                      style={{ color: glyph.tone }}
                      aria-hidden="true"
                    >
                      {glyph.glyph}
                    </span>
                    <span className="min-w-0 font-sans text-ink">
                      <span className="font-mono text-[10px] text-stone">
                        R{repair.round} {repair.by} ·{" "}
                      </span>
                      {repair.detail.reason ?? repair.op}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The line above the composer while something runs: what, how long, how much, and a way out. */
function WorkingLine({
  label,
  costUsd,
  since,
  onStop,
}: NonNullable<Working> & { onStop: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2 border-ink/15 border-t bg-paper px-4 py-2 font-mono text-xs">
      <span className="cm-spin text-brass" aria-hidden="true">
        ✻
      </span>
      <span className="cm-text-shimmer min-w-0 truncate font-bold">
        {label}…
      </span>
      <span className="shrink-0 text-ink-muted">
        {seconds(Math.max(0, (now - since) / 1000))}
        {costUsd > 0 ? ` · $${costUsd.toFixed(4)}` : ""}
      </span>
      <button
        type="button"
        onClick={onStop}
        className="ml-auto shrink-0 text-ink-muted underline hover:text-seal-red"
      >
        esc to stop
      </button>
    </div>
  );
}
