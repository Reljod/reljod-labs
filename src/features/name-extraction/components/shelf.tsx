"use client";

import { AnimatePresence, motion } from "motion/react";
import { type Ref, useState } from "react";
import type { CorpusCard } from "../domain/contract";
import { SOFT } from "./motion-kit";
import { PageStack } from "./page-stack";
import { plural } from "./plain";
import { cx } from "./ui";
import { type Uploaded, UploadZone } from "./upload-zone";

export const stackId = (id: string) => `sv-stack-${id}`;

function DocumentCard({
  card,
  index,
  onOpen,
  onIntent,
}: {
  card: CorpusCard;
  index: number;
  onOpen: (card: CorpusCard) => void;
  onIntent: (card: CorpusCard) => void;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ ...SOFT, delay: Math.min(index, 8) * 0.045 }}
    >
      <motion.button
        type="button"
        initial="rest"
        animate="rest"
        whileHover="hover"
        whileFocus="hover"
        onClick={() => onOpen(card)}
        onPointerEnter={() => onIntent(card)}
        onFocus={() => onIntent(card)}
        aria-label={`Open ${card.title}, ${card.pages} pages, ${card.expectedNames} names inside`}
        className="group outline-box press flex h-full w-full flex-col overflow-hidden rounded-sm bg-paper text-left focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-federal-blue"
      >
        <span className="relative flex h-44 items-center justify-center overflow-hidden border-ink border-b-2 bg-limestone/45">
          <span
            aria-hidden="true"
            className="absolute inset-0 opacity-50 [background-image:radial-gradient(rgb(20_33_61_/_0.12)_1px,transparent_1px)] [background-size:12px_12px]"
          />
          <PageStack
            pages={card.pages}
            layoutId={stackId(card.id)}
            seed={index}
          />
          <span className="absolute top-2.5 right-2.5 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-[0.65rem] font-bold text-paper">
            {card.pages} pp
          </span>
        </span>
        <span className="flex flex-1 flex-col gap-1.5 p-4">
          <span className="eyebrow text-[0.62rem] text-federal-blue">
            {card.genre}
          </span>
          <span className="text-[1.02rem] leading-snug font-semibold">
            {card.title}
          </span>
          <span className="line-clamp-2 text-sm text-ink-muted">
            {card.description}
          </span>
          <span className="mt-auto flex items-center justify-between gap-2 pt-2 font-mono text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-3 bg-brass" />
              {plural(card.expectedNames, "name")} inside
            </span>
            <span className="font-semibold text-federal-blue transition-transform group-hover:translate-x-0.5">
              Open →
            </span>
          </span>
        </span>
      </motion.button>
    </motion.li>
  );
}

/**
 * The demo documents (featured first, the rest a click away) and the drop
 * zone for one's own PDF.
 */
export function Shelf({
  corpus,
  onIntent,
  onOpen,
  onUploaded,
  uploadRef,
}: {
  corpus: CorpusCard[];
  /** The visitor is about to open a card (hover, focus): start loading it. */
  onIntent: (card: CorpusCard) => void;
  onOpen: (card: CorpusCard) => void;
  onUploaded: (upload: Uploaded) => void;
  uploadRef?: Ref<HTMLInputElement>;
}) {
  const [all, setAll] = useState(false);
  const cards = corpus;
  const featured = cards.filter((card) => card.featured);
  const lead = featured.length > 0 ? featured : cards.slice(0, 6);
  const rest = cards.filter((card) => !lead.includes(card));
  const shown = all ? [...lead, ...rest] : lead;

  return (
    <section
      id="sv-documents"
      aria-labelledby="sv-documents-title"
      className="flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="sv-documents-title"
            className="font-mono text-2xl font-bold uppercase sm:text-3xl"
          >
            Try it on a document
          </h2>
          <p className="text-sm text-ink-muted">
            Synthetic bank files with every name planted, so you can check the
            result.
          </p>
        </div>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false}>
          {shown.map((card, index) => (
            <DocumentCard
              key={card.id}
              card={card}
              index={index}
              onOpen={onOpen}
              onIntent={onIntent}
            />
          ))}
        </AnimatePresence>
      </ul>

      {rest.length > 0 ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((value) => !value)}
          className={cx(
            "outline-box press mx-auto inline-flex h-10 items-center gap-2 rounded-sm bg-paper px-5 font-mono text-xs font-bold uppercase",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
          )}
        >
          {all ? "Fewer documents" : `More documents (${rest.length})`}
          <motion.span animate={{ rotate: all ? 180 : 0 }} aria-hidden="true">
            ↓
          </motion.span>
        </button>
      ) : null}

      <UploadZone onUploaded={onUploaded} inputRef={uploadRef} />
    </section>
  );
}
