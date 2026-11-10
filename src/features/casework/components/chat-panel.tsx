"use client";

import {
  type FormEvent,
  Fragment,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import { type ChoiceOption, MAX_MESSAGE_LENGTH } from "../domain/chat-events";
import { kindLabel } from "../domain/document-kinds";
import { JOBS } from "../domain/jobs";
import { PIPELINES } from "../domain/pipelines";
import type { Answer } from "../domain/run-events";
import type { DocView, RunSummary } from "../view";
import { readDragDocs } from "./cabinet";
import { FileGlyph, RECOMMENDATION_STYLE } from "./glyphs";
import type { OpenQuestion } from "./run-reducer";
import { filesFromDrop, hasFiles } from "./upload";

export type ChatTool = {
  name: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
};

export type ChatItem = {
  id: string;
  role: "user" | "specialist";
  text: string;
  documentNames: string[];
  tools: ChatTool[];
  pending?: boolean;
  /** What the model thought before it answered. */
  reasoning?: string;
  choices?: { question: string; options: ChoiceOption[] } | null;
  /** The Run this message started, shown as a card under it. */
  runId?: string | null;
};

/** A Run as its card in the chat shows it. */
export type RunCard = RunSummary & {
  headline?: string;
  seconds?: number;
  selected: boolean;
};

const STARTERS: ChoiceOption[] = [
  {
    label: "What can you do?",
    detail: "The four reviews and the single jobs",
  },
  {
    label: "Review the Hydes mortgage withdrawal",
    detail: "Finds the case in the Cabinet and runs the full pipeline",
  },
  {
    label: "Screen everyone in the Herrera Castillo alert",
    detail: "One job, not a whole review",
  },
];

export function toolTitle(name: string) {
  if (name.startsWith("pipeline_")) {
    const id = name.slice(9) as keyof typeof PIPELINES;
    return PIPELINES[id]?.title ?? name;
  }
  if (name.startsWith("job_")) {
    const job = name.slice(4) as keyof typeof JOBS;
    return `${JOBS[job]?.title ?? job} job`;
  }
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toolArgs(input: unknown) {
  if (!input || typeof input !== "object") return "";
  const args = input as Record<string, unknown>;
  if (typeof args.query === "string") return `"${args.query}"`;
  if (Array.isArray(args.documentIds))
    return `${args.documentIds.length} document${args.documentIds.length === 1 ? "" : "s"}`;
  if (typeof args.choice === "string") return args.choice;
  if (args.skip) return "go on without it";
  return "";
}

/** Bold and code spans, and nothing else: the Specialist writes short plain replies. */
function rich(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    const key = `${index}-${part.slice(0, 8)}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code
          key={key}
          className="rounded-[2px] bg-limestone/60 px-1 font-mono text-[0.92em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    return <Fragment key={key}>{part}</Fragment>;
  });
}

type ChatPanelProps = {
  items: ChatItem[];
  tray: DocView[];
  onRemoveFromTray: (id: string) => void;
  onAddToTray: (ids: string[]) => void;
  onSend: (text: string) => void;
  /** The Specialist is answering. */
  busy: boolean;
  /** The desk is not open yet. */
  disabled: boolean;
  /** Something from the Cabinet is being dragged. */
  dragging: boolean;
  question: OpenQuestion | null;
  onAnswer: (answer: Answer) => void;
  answering: boolean;
  questionRef: Ref<HTMLDivElement>;
  runs: Map<string, RunCard>;
  onSelectRun: (id: string) => void;
  onOpenFile: (id: string) => void;
  /** What is going on right now, or null when nothing is. */
  working: { label: string; costUsd: number; since: number } | null;
  onStop: () => void;
  onDropFiles: (files: File[]) => void;
  /** "GLM 5.3 Flash · low", the chat model in a few words. */
  model: string;
};

/** The Specialist's chat: a transcript of messages, tool calls and choices, and the composer. */
export function ChatPanel(props: ChatPanelProps) {
  const { items, tray, busy, question, working } = props;
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const last = items.at(-1);
  const blocked = busy || props.disabled;

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new and growing messages
  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [
    items.length,
    last?.text,
    last?.tools.length,
    last?.choices,
    question?.questionId,
    props.runs,
  ]);

  // Escape stops whatever is going, from anywhere on the desk.
  const { onStop } = props;
  const stoppable = Boolean(working);
  useEffect(() => {
    if (!stoppable) return;
    const stop = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      onStop();
    };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [stoppable, onStop]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (blocked || (!text.trim() && tray.length === 0)) return;
    props.onSend(text.trim());
    setText("");
  }

  const empty = items.length === 0;
  const choices = !blocked && last?.role === "specialist" ? last.choices : null;

  return (
    <section
      aria-label="Chat with the Specialist"
      className="cw-droppable relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-sm border-2 border-ink bg-paper shadow-hard-md"
      data-over={over}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const docs = readDragDocs(event);
        if (docs) {
          props.onAddToTray(docs.ids);
          return;
        }
        if (hasFiles(event.dataTransfer)) {
          const files = await filesFromDrop(event.dataTransfer);
          if (files.length) props.onDropFiles(files);
        }
      }}
    >
      <header className="flex items-center gap-2.5 border-ink border-b-2 bg-ink px-3 py-2.5 text-paper">
        <span
          className={`size-2.5 rounded-full ${working ? "cw-pulse bg-brass" : "bg-[#7fd38f]"}`}
        />
        <p className="font-mono text-sm font-bold tracking-[0.1em] uppercase">
          Specialist
        </p>
        <span
          className="ml-auto truncate rounded-sm border border-paper/30 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em] text-paper/80"
          title="The chat model. Change it in Pipelines or Settings."
        >
          {props.model}
        </span>
      </header>

      <div
        ref={listRef}
        aria-live="polite"
        className="cw-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-[13.5px] leading-relaxed"
      >
        {empty ? (
          <div className="cw-reveal my-auto">
            <p className="font-mono text-[11px] tracking-[0.1em] text-federal-blue uppercase">
              ✻ Welcome to the desk
            </p>
            <p className="mt-2 font-mono text-lg leading-tight font-bold">
              Drop a case, or tell me what you need.
            </p>
            <p className="mt-2 text-ink-muted">
              I check that I have the documents and know what to do before I
              start anything. When I don't, I ask.
            </p>
            <Choices
              question="Try one"
              options={STARTERS}
              disabled={blocked}
              onPick={(label) => props.onSend(label)}
            />
          </div>
        ) : null}

        {items.map((item) =>
          item.role === "user" ? (
            <UserMessage key={item.id} item={item} />
          ) : (
            <SpecialistMessage key={item.id} item={item} {...props} />
          ),
        )}

        {choices ? (
          <Choices
            question={choices.question}
            options={choices.options}
            disabled={blocked}
            onPick={(label) => props.onSend(label)}
            typeHint
          />
        ) : null}

        {question ? <QuestionCard {...props} question={question} /> : null}
      </div>

      {working ? <Working {...working} onStop={props.onStop} /> : null}

      <form onSubmit={submit} className="border-ink border-t-2 bg-marble/50">
        {tray.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {tray.map((doc) => (
              <li
                key={doc.id}
                className="cw-reveal flex max-w-44 items-center gap-1 rounded-sm border border-ink/40 bg-paper py-0.5 pr-0.5 pl-1.5 text-xs"
              >
                <FileGlyph format={doc.sourceFormat} size={12} />
                <span className="truncate">{doc.name}</span>
                <button
                  type="button"
                  onClick={() => props.onRemoveFromTray(doc.id)}
                  className="px-1 font-mono font-bold text-ink-muted hover:text-seal-red"
                  aria-label={`Remove ${doc.name}`}
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
          <label htmlFor="casework-input" className="sr-only">
            Message the Specialist
          </label>
          <textarea
            id="casework-input"
            ref={inputRef}
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
              props.dragging || over
                ? "Drop it here"
                : tray.length
                  ? "Add a note, or just press Enter"
                  : "Ask, or drop documents"
            }
            className="min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 font-mono text-[13px] leading-relaxed placeholder:text-stone focus:outline-none"
          />
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
              disabled={blocked || (!text.trim() && tray.length === 0)}
              className="press mt-0.5 h-8 rounded-sm border-2 border-ink bg-federal-blue px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-paper uppercase disabled:opacity-35"
            >
              Send
            </button>
          )}
        </div>
        <p className="px-3 pt-1 pb-2 font-mono text-[10px] tracking-[0.02em] text-stone">
          enter to send · shift+enter for a new line · drop files or folders
          {working ? " · esc to stop" : ""}
        </p>
      </form>
    </section>
  );
}

function Attachments({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {names.slice(0, 5).map((name) => (
        <span
          key={name}
          className="flex max-w-44 items-center gap-1 rounded-sm border border-ink/30 bg-paper px-1.5 py-0.5 text-[11px]"
        >
          <FileGlyph
            format={
              name.endsWith(".csv")
                ? "csv"
                : /\.(jpe?g|png)$/i.test(name)
                  ? "image"
                  : "pdf"
            }
            size={11}
          />
          <span className="truncate">{name}</span>
        </span>
      ))}
      {names.length > 5 ? (
        <span className="rounded-sm border border-ink/30 bg-paper px-1.5 py-0.5 font-mono text-[11px]">
          +{names.length - 5}
        </span>
      ) : null}
    </div>
  );
}

function UserMessage({ item }: { item: ChatItem }) {
  return (
    <div className="cw-reveal rounded-sm border-l-[3px] border-federal-blue bg-morning-haze/50 py-2 pr-3 pl-3">
      <p className="flex gap-2 font-mono text-[13px]">
        <span className="font-bold text-federal-blue" aria-hidden="true">
          ❯
        </span>
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {item.text || (
            <span className="text-ink-muted">(documents, no note)</span>
          )}
        </span>
      </p>
      <Attachments names={item.documentNames} />
    </div>
  );
}

function SpecialistMessage({
  item,
  ...props
}: ChatPanelProps & { item: ChatItem }) {
  const [showThinking, setShowThinking] = useState(false);
  const run = item.runId ? props.runs.get(item.runId) : undefined;
  const thinking = item.pending && !item.text && item.tools.length === 0;
  return (
    <div className="cw-reveal grid gap-2">
      {item.reasoning ? (
        <div>
          <button
            type="button"
            onClick={() => setShowThinking(!showThinking)}
            aria-expanded={showThinking}
            className="font-mono text-[11px] text-stone italic hover:text-ink-muted"
          >
            ∴ {item.pending && !item.text ? "Thinking" : "Thought"} for a moment{" "}
            {showThinking ? "▾" : "▸"}
          </button>
          {showThinking ? (
            <p className="mt-1 border-ink/15 border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-ink-muted italic">
              {item.reasoning.trim()}
            </p>
          ) : null}
        </div>
      ) : null}

      {item.tools.map((tool, index) => (
        <ToolLine
          key={`${tool.name}-${index}`}
          tool={tool}
          running={Boolean(item.pending) && tool.ok === undefined}
        />
      ))}

      {item.text ? (
        <p className="flex gap-2">
          <span className="font-mono text-ink" aria-hidden="true">
            ●
          </span>
          <span className="min-w-0 break-words whitespace-pre-wrap">
            {rich(item.text)}
            {item.pending ? <span className="cw-caret ml-0.5">▍</span> : null}
          </span>
        </p>
      ) : thinking ? (
        <output
          className="cw-shimmer font-mono text-xs"
          aria-label="The Specialist is thinking"
        >
          ✻ Thinking…
        </output>
      ) : null}

      {run ? <RunCardView run={run} {...props} /> : null}
    </div>
  );
}

function ToolLine({ tool, running }: { tool: ChatTool; running: boolean }) {
  const args = toolArgs(tool.input);
  const tone =
    tool.ok === false
      ? "text-seal-red"
      : running
        ? "cw-pulse text-brass"
        : "text-ivy";
  return (
    <div className="font-mono text-xs" title="A tool call over MCP">
      <p className="flex gap-2">
        <span className={tone} aria-hidden="true">
          ●
        </span>
        <span className="min-w-0">
          <span className="font-bold">{toolTitle(tool.name)}</span>
          {args ? <span className="text-ink-muted">({args})</span> : null}
        </span>
      </p>
      {tool.summary || running ? (
        <p className="flex gap-2 pl-[3px] text-ink-muted">
          <span aria-hidden="true">⎿</span>
          <span
            className={`min-w-0 break-words ${tool.ok === false ? "text-seal-red" : ""}`}
          >
            {running ? "Running…" : tool.summary?.split(/[.:] /)[0]}
          </span>
        </p>
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
  typeHint,
}: {
  question: string;
  options: ChoiceOption[];
  disabled: boolean;
  onPick: (label: string) => void;
  typeHint?: boolean;
}) {
  return (
    <div className="cw-reveal mt-1 rounded-sm border-2 border-ink bg-paper">
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
      {typeHint ? (
        <p className="border-ink/15 border-t px-3 py-1.5 font-mono text-[10px] text-stone">
          or type something else below
        </p>
      ) : null}
    </div>
  );
}

const RUN_STATUS: Record<
  RunSummary["status"],
  { label: string; tone: string }
> = {
  queued: { label: "Starting", tone: "text-federal-blue" },
  running: { label: "Running", tone: "text-federal-blue" },
  waiting: { label: "Waiting on you", tone: "text-oak" },
  completed: { label: "Done", tone: "text-ivy" },
  failed: { label: "Failed", tone: "text-seal-red" },
  stopped: { label: "Stopped", tone: "text-seal-red" },
};

/** One Run in the transcript: what it was, how it ended and what it cost. */
function RunCardView({ run, ...props }: ChatPanelProps & { run: RunCard }) {
  const over =
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "stopped";
  const style =
    run.recommendation && run.recommendation in RECOMMENDATION_STYLE
      ? RECOMMENDATION_STYLE[
          run.recommendation as keyof typeof RECOMMENDATION_STYLE
        ]
      : null;
  const title = run.pipeline
    ? PIPELINES[run.pipeline].title
    : run.jobs.map((job) => JOBS[job].title).join(" → ");
  return (
    <div
      className={`rounded-sm border-2 bg-paper ${run.selected ? "border-ink shadow-hard-sm" : "border-ink/40"}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={`size-2 shrink-0 rounded-full bg-current ${RUN_STATUS[run.status].tone} ${over ? "" : "cw-pulse"}`}
        />
        <p className="min-w-0 flex-1 truncate font-mono text-xs font-bold tracking-[0.04em] uppercase">
          {title}
        </p>
        {style ? (
          <span
            className={`shrink-0 rounded-sm border-2 px-1.5 font-mono text-[10px] font-bold tracking-[0.08em] uppercase ${style.tone}`}
          >
            {style.stamp}
          </span>
        ) : (
          <span
            className={`shrink-0 font-mono text-[10px] font-bold tracking-[0.06em] uppercase ${RUN_STATUS[run.status].tone}`}
          >
            {RUN_STATUS[run.status].label}
          </span>
        )}
      </div>
      {run.headline ? (
        <p className="border-ink/10 border-t px-3 py-2 text-[13px]">
          {run.headline}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-ink/10 border-t bg-marble/50 px-3 py-1.5 font-mono text-[11px] text-ink-muted">
        <span title="What this run's model calls cost">
          {over ? "Cost" : "So far"}{" "}
          <span className="font-bold text-ink">${run.costUsd.toFixed(4)}</span>
        </span>
        <span>
          {run.calls} call{run.calls === 1 ? "" : "s"}
        </span>
        {run.seconds ? <span>{formatSeconds(run.seconds)}</span> : null}
        <span className="ml-auto flex gap-3">
          {run.status === "completed" && run.recommendation && run.selected ? (
            <button
              type="button"
              onClick={() => props.onOpenFile(run.id)}
              className="font-bold text-federal-blue underline"
            >
              Decision file
            </button>
          ) : null}
          {run.selected ? null : (
            <button
              type="button"
              onClick={() => props.onSelectRun(run.id)}
              className="font-bold text-federal-blue underline"
            >
              Show on stage
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function formatSeconds(seconds: number) {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

/** The line above the composer while something runs: what, how long, how much, and a way out. */
function Working({
  label,
  costUsd,
  since,
  onStop,
}: {
  label: string;
  costUsd: number;
  since: number;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2 border-ink/15 border-t bg-paper px-4 py-2 font-mono text-xs">
      <span className="cw-spin text-brass" aria-hidden="true">
        ✻
      </span>
      <span className="cw-shimmer min-w-0 truncate font-bold">{label}…</span>
      <span className="shrink-0 text-ink-muted">
        {formatSeconds(Math.max(0, (now - since) / 1000))}
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

/** A Run paused on a Question: answer with a drop, a button, or a few words in the composer. */
function QuestionCard(props: ChatPanelProps & { question: OpenQuestion }) {
  const { question, answering } = props;
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; its buttons carry keyboard access
    <div
      ref={props.questionRef}
      className="cw-droppable cw-reveal rounded-sm border-2 border-ink bg-brass/15"
      data-over={over}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        const docs = readDragDocs(event);
        if (!docs) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        props.onAnswer({ documentIds: docs.ids });
      }}
    >
      <p className="flex items-center gap-2 border-ink/20 border-b px-3 py-2 font-mono text-[11px] font-bold tracking-[0.06em] text-oak uppercase">
        <span className="cw-pulse size-2 rounded-full bg-brass" />
        {JOBS[question.job].title} is waiting on you
      </p>
      <p className="px-3 pt-2 text-[13px] font-medium">{question.prompt}</p>
      {question.kinds.length > 0 ? (
        <p className="mx-3 mt-2 rounded-sm border border-dashed border-ink/50 bg-paper/70 px-2 py-2 text-center font-mono text-[11px] tracking-[0.04em] text-ink-muted uppercase">
          Drop {question.kinds.map(kindLabel).join(" or ")} here
        </p>
      ) : null}
      <ol className="mt-2 grid border-ink/20 border-t bg-paper/60">
        {[
          ...question.options.map((option) => ({
            label: option.label,
            answer: { choice: option.value } as Answer,
          })),
          ...(props.tray.length > 0 && question.kinds.length > 0
            ? [
                {
                  label: `Use the ${props.tray.length} attached`,
                  answer: {
                    documentIds: props.tray.map((doc) => doc.id),
                  } as Answer,
                },
              ]
            : []),
          { label: "Go on without it", answer: { skip: true } as Answer },
        ].map((option, index) => (
          <li key={option.label}>
            <button
              type="button"
              disabled={answering}
              onClick={() => props.onAnswer(option.answer)}
              className="group flex w-full items-baseline gap-2 border-ink/10 border-b px-3 py-1.5 text-left last:border-b-0 hover:bg-morning-haze/60 disabled:opacity-50"
            >
              <span className="font-mono text-xs text-ink-muted">
                {index + 1}.
              </span>
              <span className="text-[13px] font-semibold">{option.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
