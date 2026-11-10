"use client";

import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type Ref, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "../domain/chat-events";
import { kindLabel } from "../domain/document-kinds";
import { JOBS } from "../domain/jobs";
import type { Answer } from "../domain/run-events";
import type { DocView } from "../view";
import { readDragDocs } from "./cabinet";
import { FileGlyph } from "./glyphs";
import type { OpenQuestion } from "./run-reducer";

export type ChatItem = {
  id: string;
  role: "user" | "specialist";
  text: string;
  documentNames: string[];
  tools: { name: string; ok?: boolean }[];
  pending?: boolean;
};

const SUGGESTIONS = [
  { label: "Review a withdrawal", text: "Review this pension withdrawal" },
  { label: "Just extract", text: "Just read these and pull out the fields" },
  { label: "Screen names", text: "Screen everyone in these documents" },
  { label: "What can you do?", text: "What can you do?" },
];

const TOOL_LABEL = (name: string) => {
  if (name.startsWith("pipeline_"))
    return `pipeline · ${name.slice(9).replaceAll("_", " ")}`;
  if (name.startsWith("job_")) {
    const job = name.slice(4) as keyof typeof JOBS;
    return `job · ${JOBS[job]?.title.toLowerCase() ?? job}`;
  }
  return name.replaceAll("_", " ");
};

type ChatPanelProps = {
  items: ChatItem[];
  tray: DocView[];
  onRemoveFromTray: (id: string) => void;
  onAddToTray: (ids: string[]) => void;
  onSend: (text: string) => void;
  busy: boolean;
  dragging: boolean;
  question: OpenQuestion | null;
  onAnswer: (answer: Answer) => void;
  answering: boolean;
  /** Where Ledger perches when he is not out on the stage. */
  perchRef: Ref<HTMLDivElement>;
  questionRef: Ref<HTMLDivElement>;
  wide: boolean;
};

/** The Specialist's chat: messages, the open question, and the composer. */
export function ChatPanel(props: ChatPanelProps) {
  const { items, tray, busy, question } = props;
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const last = items.at(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new and growing messages
  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [items.length, last?.text, question?.questionId]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || (!text.trim() && tray.length === 0)) return;
    props.onSend(text.trim());
    setText("");
  }

  const empty = items.length === 0;

  return (
    <section
      aria-label="Chat with the Specialist"
      className="outline-box relative flex h-full min-h-0 flex-col rounded-sm bg-paper shadow-hard-lg"
    >
      <div
        ref={props.perchRef}
        className="pointer-events-none absolute top-0 right-8 h-px w-[76px]"
      />
      <header className="flex items-center gap-3 border-ink border-b-2 bg-morning-haze px-4 py-3">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ivy opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full bg-ivy" />
        </span>
        <p className="font-mono text-sm font-bold tracking-[0.1em] uppercase">
          The Specialist
        </p>
        <p
          className={`eyebrow ml-auto text-ink-muted ${props.wide ? "" : "hidden xl:block"}`}
        >
          {busy ? "Working" : "Pensions · trusts · screening"}
        </p>
      </header>

      <ol
        ref={listRef}
        aria-live="polite"
        className="cw-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {empty ? (
          <li className="m-auto max-w-sm py-6 text-center">
            <p className="font-mono text-lg font-bold uppercase leading-tight">
              Drop a case. I'll know what to do.
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              Withdrawals, employers, structures, screening alerts. Drag files
              from the Cabinet, or ask for one step.
            </p>
          </li>
        ) : null}
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li
              key={item.id}
              layout="position"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={`max-w-[88%] ${item.role === "user" ? "self-end" : "self-start"}`}
            >
              {item.documentNames.length > 0 ? (
                <div
                  className={`mb-1 flex flex-wrap gap-1 ${item.role === "user" ? "justify-end" : ""}`}
                >
                  {item.documentNames.slice(0, 4).map((name) => (
                    <span
                      key={name}
                      className="flex max-w-40 items-center gap-1 rounded-sm border-2 border-ink bg-limestone px-1.5 py-0.5 text-[11px]"
                    >
                      <FileGlyph
                        format={
                          name.endsWith(".csv")
                            ? "csv"
                            : name.endsWith(".jpg")
                              ? "image"
                              : "pdf"
                        }
                        size={12}
                      />
                      <span className="truncate">{name}</span>
                    </span>
                  ))}
                  {item.documentNames.length > 4 ? (
                    <span className="rounded-sm border-2 border-ink bg-limestone px-1.5 py-0.5 font-mono text-[11px]">
                      +{item.documentNames.length - 4}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {item.text || item.pending ? (
                <div
                  className={`rounded-sm border-2 px-3 py-2 text-sm leading-relaxed ${item.role === "user" ? "border-ink bg-federal-blue text-paper" : "border-limestone bg-marble"}`}
                >
                  {item.text ? (
                    item.text
                  ) : (
                    <output
                      className="flex gap-1 py-1"
                      aria-label="The Specialist is thinking"
                    >
                      <span className="cw-dot size-1.5 rounded-full bg-ink" />
                      <span className="cw-dot size-1.5 rounded-full bg-ink" />
                      <span className="cw-dot size-1.5 rounded-full bg-ink" />
                    </output>
                  )}
                </div>
              ) : null}
              {item.tools.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.tools.map((tool, index) => (
                    <span
                      key={`${tool.name}-${index}`}
                      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase ${tool.ok === false ? "border-seal-red text-seal-red" : "border-ink/50 text-ink-muted"}`}
                      title="A tool call over MCP"
                    >
                      <span aria-hidden="true">⚙</span>
                      {TOOL_LABEL(tool.name)}
                    </span>
                  ))}
                </div>
              ) : null}
            </motion.li>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {question ? (
            <motion.li
              key={question.questionId}
              initial={{ opacity: 0, y: 16, rotate: -1 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="self-stretch"
            >
              <QuestionCard {...props} question={question} />
            </motion.li>
          ) : null}
        </AnimatePresence>
      </ol>

      <form
        onSubmit={submit}
        className="cw-droppable border-ink border-t-2 bg-paper p-3"
        data-over={over || props.dragging}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const docs = readDragDocs(event);
          if (docs) props.onAddToTray(docs.ids);
        }}
      >
        <AnimatePresence initial={false}>
          {tray.length > 0 ? (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-2 flex flex-wrap gap-1.5 overflow-hidden"
            >
              {tray.map((doc) => (
                <motion.li
                  key={doc.id}
                  layout
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex max-w-48 items-center gap-1 rounded-sm border-2 border-ink bg-morning-haze py-0.5 pr-0.5 pl-1.5 text-xs"
                >
                  <FileGlyph format={doc.sourceFormat} size={12} />
                  <span className="truncate">{doc.name}</span>
                  <button
                    type="button"
                    onClick={() => props.onRemoveFromTray(doc.id)}
                    className="px-1 font-mono font-bold hover:text-seal-red"
                    aria-label={`Remove ${doc.name}`}
                  >
                    ×
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
        {empty && tray.length === 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => setText(suggestion.text)}
                className="rounded-sm border-2 border-ink/30 px-2 py-1 font-mono text-[11px] tracking-[0.04em] uppercase hover:border-ink hover:bg-marble"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <label htmlFor="casework-input" className="sr-only">
            Message the Specialist
          </label>
          <textarea
            id="casework-input"
            value={text}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              props.dragging
                ? "Drop it here"
                : tray.length
                  ? "Add a note, or just press Enter"
                  : "Ask, or drop documents"
            }
            className="outline-box max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-sm bg-marble px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
          />
          <button
            type="submit"
            disabled={busy || (!text.trim() && tray.length === 0)}
            className="outline-box press min-h-11 rounded-sm bg-federal-blue px-4 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

function QuestionCard(props: ChatPanelProps & { question: OpenQuestion }) {
  const { question, answering } = props;
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; its buttons carry keyboard access
    <div
      ref={props.questionRef}
      className="cw-droppable cw-wait relative rounded-sm border-2 border-ink bg-brass/25 p-3"
      data-over={over}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const docs = readDragDocs(event);
        if (docs) props.onAnswer({ documentIds: docs.ids });
      }}
    >
      <p className="eyebrow mb-1 font-bold text-oak">
        {JOBS[question.job].title} is waiting on you
      </p>
      <p className="text-sm font-medium">{question.prompt}</p>
      {question.kinds.length > 0 ? (
        <p className="mt-2 rounded-sm border-2 border-dashed border-ink/50 bg-paper/70 px-2 py-2 text-center font-mono text-[11px] tracking-[0.06em] text-ink-muted uppercase">
          Drop {question.kinds.map(kindLabel).join(" or ")} here
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {question.options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={answering}
            onClick={() => props.onAnswer({ choice: option.value })}
            className="outline-box press rounded-sm bg-paper px-2 py-1 font-mono text-[11px] font-bold tracking-[0.04em] uppercase disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
        {props.tray.length > 0 && question.kinds.length > 0 ? (
          <button
            type="button"
            disabled={answering}
            onClick={() =>
              props.onAnswer({ documentIds: props.tray.map((doc) => doc.id) })
            }
            className="outline-box press rounded-sm bg-federal-blue px-2 py-1 font-mono text-[11px] font-bold tracking-[0.04em] text-paper uppercase disabled:opacity-50"
          >
            Use {props.tray.length} attached
          </button>
        ) : null}
        <button
          type="button"
          disabled={answering}
          onClick={() => props.onAnswer({ skip: true })}
          className="rounded-sm px-2 py-1 font-mono text-[11px] font-bold tracking-[0.04em] text-ink-muted uppercase underline hover:text-ink disabled:opacity-50"
        >
          Go on without it
        </button>
      </div>
    </div>
  );
}
