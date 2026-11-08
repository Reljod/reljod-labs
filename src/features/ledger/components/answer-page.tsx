"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { Sentence } from "../domain/build-plan";
import { BlockView } from "./block-view";
import type { PlacedBlock } from "./placed-block";

const MS_PER_CHARACTER = 16;

/** How long Ledger takes to write a sentence out; his pen keeps the same pace. */
export const typingMs = (text: string) =>
  Math.min(2400, Math.max(500, text.length * MS_PER_CHARACTER));

const KIND_LABEL: Record<PlacedBlock["block"]["kind"], string> = {
  figure: "Figure",
  quote: "Quote",
  card: "Card",
  job: "Role",
  contact: "Contact",
};

type AnswerPageProps = {
  question: string;
  title: string;
  /** In citation order: block 1 is the first fetched. */
  blocks: PlacedBlock[];
  writeup: Sentence[];
  /** Sentences written so far; the rest hold their place, unwritten. */
  typed: number;
  /** Plays the gold sweep under the title, once, when the Write-up is done. */
  sweep: boolean;
  busy: boolean;
  onReplay: () => void;
  onRedo: () => void;
};

/** The answer Ledger writes from the Stack, with every block it came from floating beside it. */
export function AnswerPage({
  question,
  title,
  blocks,
  writeup,
  typed,
  sweep,
  busy,
  onReplay,
  onRedo,
}: AnswerPageProps) {
  const [open, setOpen] = useState<number | null>(null);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const floating = blocks
    .map((item, index) => ({ item, number: index + 1 }))
    .filter(({ number }) => !closed.has(number));
  const expanded = open ? blocks[open - 1] : null;

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const show = (number: number) => {
    setClosed((current) => {
      const next = new Set(current);
      next.delete(number);
      return next;
    });
    setOpen(number);
  };

  return (
    <article
      data-testid="answer-page"
      aria-labelledby="answer-title"
      className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-muted">{question}</p>
          <h1
            id="answer-title"
            className="mt-3 font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-5xl"
          >
            <span className={sweep ? "ldg-sweep" : undefined}>{title}</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="replay-build"
            disabled={busy}
            onClick={onReplay}
            className="outline-box press inline-flex min-h-11 items-center gap-2 rounded-sm bg-paper px-3 font-mono text-xs font-bold tracking-[0.1em] uppercase disabled:opacity-50"
          >
            <Icon name="replay" size={18} />
            Replay
          </button>
          <button
            type="button"
            data-testid="redo-build"
            disabled={busy}
            onClick={onRedo}
            className="outline-box press inline-flex min-h-11 items-center gap-2 rounded-sm bg-federal-blue px-3 font-mono text-xs font-bold tracking-[0.1em] text-paper uppercase disabled:opacity-50"
          >
            <Icon name="redo" size={18} />
            Redo
          </button>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <p
          data-testid="writeup"
          className="max-w-3xl text-xl leading-relaxed sm:text-2xl"
        >
          {writeup.map((sentence, index) => (
            <TypedSentence
              key={`${index}-${sentence.text}`}
              index={index}
              sentence={sentence}
              state={
                index < typed - 1
                  ? "written"
                  : index === typed - 1
                    ? "writing"
                    : "waiting"
              }
              onCite={show}
            />
          ))}
        </p>

        <aside
          aria-label="Sources"
          className="lg:sticky lg:top-24 lg:self-start"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="eyebrow font-bold">Sources</p>
            {closed.size > 0 ? (
              <button
                type="button"
                data-testid="show-sources"
                onClick={() => setClosed(new Set())}
                className="eyebrow font-bold text-federal-blue underline"
              >
                Show {closed.size} hidden
              </button>
            ) : null}
          </div>
          <ul className="flex gap-4 max-lg:overflow-x-auto max-lg:pb-3 lg:flex-col">
            <AnimatePresence initial={false}>
              {floating.map(({ item, number }) => (
                <motion.li
                  key={item.id}
                  layoutId={item.id}
                  exit={{
                    opacity: 0,
                    scale: 0.6,
                    rotate: 12,
                    transition: { duration: 0.25 },
                  }}
                  transition={{ type: "spring", stiffness: 140, damping: 20 }}
                  data-testid="source-block"
                  data-source={item.source}
                  data-excerpt={item.excerpt ?? undefined}
                  data-kind={item.block.kind}
                  className="ldg-float relative shrink-0 max-lg:w-64"
                  style={{ animationDelay: `${number * -0.7}s` }}
                >
                  <div className="outline-box rounded-sm bg-paper shadow-hard-md">
                    <div className="flex items-center gap-2 border-ink border-b-2 bg-morning-haze px-2 py-1">
                      <span className="eyebrow rounded-sm border-2 border-ink bg-brass px-1.5 font-bold">
                        {number}
                      </span>
                      <span className="eyebrow flex-1 text-ink-muted">
                        {KIND_LABEL[item.block.kind]}
                      </span>
                      <button
                        type="button"
                        aria-label={`Expand source ${number}`}
                        onClick={() => setOpen(number)}
                        className="inline-flex size-8 items-center justify-center hover:bg-paper"
                      >
                        <Icon name="expand" size={16} />
                      </button>
                      <button
                        type="button"
                        data-testid="close-source"
                        aria-label={`Close source ${number}`}
                        onClick={() =>
                          setClosed((current) => new Set(current).add(number))
                        }
                        className="inline-flex size-8 items-center justify-center hover:bg-paper"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={`Open source ${number}`}
                      onClick={() => setOpen(number)}
                      className="block w-full text-left [&_.outline-box]:border-0 [&_.outline-box]:shadow-none"
                    >
                      <BlockView block={item.block} size="compact" />
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </aside>
      </div>

      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="expanded"
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`Source ${open}`}
              data-testid="expanded-source"
              initial={{ scale: 0.8, rotate: -3, y: 30 }}
              animate={{ scale: 1, rotate: 0, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="relative w-full max-w-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(null)}
                className="outline-box press absolute -top-4 -right-4 z-10 inline-flex size-11 items-center justify-center rounded-full bg-paper"
              >
                <Icon name="close" size={18} />
              </button>
              <BlockView block={expanded.block} size="full" />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}

function TypedSentence({
  index,
  sentence,
  state,
  onCite,
}: {
  index: number;
  sentence: Sentence;
  state: "waiting" | "writing" | "written";
  onCite: (number: number) => void;
}) {
  const { text } = sentence;
  const [shown, setShown] = useState(state === "written" ? text.length : 0);

  useEffect(() => {
    if (state === "written") {
      setShown(text.length);
      return;
    }
    if (state === "waiting") {
      setShown(0);
      return;
    }
    const start = performance.now();
    const duration = typingMs(text);
    let raf = 0;
    const tick = (now: number) => {
      const count = Math.round(
        Math.min(1, (now - start) / duration) * text.length,
      );
      setShown(count);
      if (count < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, text]);

  const done = shown >= text.length;
  return (
    <span
      data-testid="writeup-sentence"
      data-sentence={index}
      data-written={done}
    >
      {/* The unwritten rest keeps its place, so the paragraph never reflows. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, shown)}
        {/* Where Ledger's pen is: he follows it as he writes. */}
        <span data-caret />
        <span className="opacity-0">{text.slice(shown)}</span>
      </span>
      {sentence.cites.map((cite) => (
        <button
          key={cite}
          type="button"
          data-testid="cite"
          aria-label={`Source ${cite}`}
          onClick={() => onCite(cite)}
          className={`mx-0.5 inline-flex min-w-6 -translate-y-2 items-center justify-center rounded-sm border-2 border-ink bg-brass px-1 align-baseline font-mono text-xs font-bold transition-opacity ${done ? "ldg-stamp-mark opacity-100" : "pointer-events-none opacity-0"}`}
        >
          {cite}
        </button>
      ))}{" "}
    </span>
  );
}
