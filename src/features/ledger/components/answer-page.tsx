"use client";

import { motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { type Layout, sentenceJoins } from "../domain/build-plan";
import { contentTree } from "../domain/content-tree";
import { BlockPhrase, BlockView } from "./block-view";
import type { PlacedBlock } from "./placed-block";

type AnswerPageProps = {
  question: string;
  title: string;
  layout: Layout;
  blocks: PlacedBlock[];
  /** Plays Reform's closing beats (the gold sweep, Joins and pieces fading in), once. */
  sweep: boolean;
};

const number = (index: number) => String(index + 1).padStart(2, "0");

/** The About section a block was cut from, as the page names it. */
const sectionOf = (item: PlacedBlock) =>
  contentTree.get(item.source)?.section ?? "site";

/* Punctuation hugs the piece before it; words get a space. */
const opensWithPunctuation = (text: string) => /^[,.;:!?)]/.test(text);
/** The last words a block shows in the sentence, so the full stop is not doubled. */
function lastWords(block: PlacedBlock["block"]) {
  switch (block.kind) {
    case "figure":
      return block.label;
    case "quote":
      return block.text;
    case "card":
      return block.title;
    case "job":
      return block.company;
    case "contact":
      return block.heading;
  }
}
const endsWithPunctuation = (item: PlacedBlock) =>
  /[.!?]$/.test(lastWords(item.block).trim());

/**
 * The page Reform makes. The placed blocks line up, in answer order, between
 * Ledger's Joins so they read as one sentence; underneath, each piece in full
 * with the section of the site it was cut from.
 */
export function AnswerPage({
  question,
  title,
  layout,
  blocks,
  sweep,
}: AnswerPageProps) {
  const joins = sentenceJoins(blocks.map((item) => item.join));
  const numbers = new Map(blocks.map((item, index) => [item.id, index]));
  const contact = blocks.filter((item) => item.block.kind === "contact");
  const body = blocks.filter((item) => item.block.kind !== "contact");
  const figures = body.filter((item) => item.block.kind === "figure");
  const rest = body.filter((item) => item.block.kind !== "figure");
  const last = blocks.at(-1);
  const reveal = (delay: number) =>
    sweep
      ? {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, duration: 0.45 },
        }
      : {};
  const detail = (item: PlacedBlock, dot = false) => (
    <Item
      key={item.id}
      item={item}
      index={numbers.get(item.id) ?? 0}
      dot={dot}
    />
  );

  return (
    <article
      data-testid="answer-page"
      data-layout={layout}
      aria-labelledby="answer-title"
      className="mx-auto max-w-6xl px-4 py-12 sm:px-6"
    >
      <p className="eyebrow text-ink-muted">
        Ledger rebuilt this for: {question}
      </p>
      <h1
        id="answer-title"
        className="mt-3 font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-5xl"
      >
        <span className={sweep ? "ldg-sweep" : undefined}>{title}</span>
      </h1>

      <p
        data-testid="answer-sentence"
        className="mt-8 max-w-4xl text-xl leading-[2.2] sm:text-2xl sm:leading-[2]"
      >
        {blocks.map((item, index) => {
          const join = joins[index];
          const before = index > 0 && !opensWithPunctuation(join) ? " " : "";
          return (
            <Fragment key={item.id}>
              {join ? (
                <>
                  {before}
                  <motion.span
                    data-testid="answer-join"
                    className="text-ink-muted italic"
                    {...reveal(0.5 + index * 0.15)}
                  >
                    {join}
                  </motion.span>{" "}
                </>
              ) : index > 0 ? (
                " "
              ) : null}
              <motion.span
                layoutId={item.id}
                data-testid="answer-block"
                data-source={item.source}
                data-excerpt={item.excerpt ?? undefined}
                data-kind={item.block.kind}
                className="outline-box relative my-1.5 inline-block max-w-full rounded-sm bg-paper px-3 pt-1 pb-1.5 align-middle leading-snug shadow-hard-sm"
                transition={{ type: "spring", stiffness: 140, damping: 20 }}
              >
                <span className="eyebrow block text-[0.625rem] text-ink-muted">
                  {number(index)} · from {sectionOf(item)}
                </span>
                <span className="font-semibold">
                  <BlockPhrase block={item.block} />
                </span>
              </motion.span>
            </Fragment>
          );
        })}
        {last && !endsWithPunctuation(last) ? (
          <motion.span
            className="text-ink-muted italic"
            {...reveal(0.5 + blocks.length * 0.15)}
          >
            .
          </motion.span>
        ) : null}
      </p>

      <motion.section
        aria-label="The pieces in full"
        className="mt-14"
        {...reveal(0.9 + blocks.length * 0.15)}
      >
        <p className="eyebrow border-ink border-b-2 pb-2 text-ink-muted">
          The pieces, in full · where each one came from
        </p>
        <div className="mt-6">
          {layout === "timeline" ? (
            <ol className="relative space-y-6 border-ink border-l-2 pl-6">
              {body.map((item) => detail(item, true))}
            </ol>
          ) : layout === "steps" ? (
            <ol className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {body.map((item) => detail(item))}
            </ol>
          ) : layout === "cards" ? (
            <Grid items={body} columns="md:grid-cols-2 lg:grid-cols-3">
              {(item) => detail(item)}
            </Grid>
          ) : (
            // figures and mixed: the headline numbers first, then what backs them up.
            <div className="space-y-6">
              <Grid items={figures} columns="sm:grid-cols-2 lg:grid-cols-3">
                {(item) => detail(item)}
              </Grid>
              <Grid
                items={rest}
                columns={
                  layout === "figures"
                    ? "md:grid-cols-2"
                    : "md:grid-cols-2 lg:grid-cols-3"
                }
              >
                {(item) => detail(item)}
              </Grid>
            </div>
          )}
          {contact.length > 0 ? (
            <div className="mt-6">
              <Grid items={contact} columns="">
                {(item) => detail(item)}
              </Grid>
            </div>
          ) : null}
        </div>
      </motion.section>
    </article>
  );
}

function Grid({
  items,
  columns,
  children,
}: {
  items: PlacedBlock[];
  columns: string;
  children: (item: PlacedBlock) => ReactNode;
}) {
  if (items.length === 0) return null;
  return <ul className={`grid gap-6 ${columns}`}>{items.map(children)}</ul>;
}

function Item({
  item,
  index,
  dot,
}: {
  item: PlacedBlock;
  index: number;
  dot?: boolean;
}) {
  return (
    <li
      data-testid="answer-detail"
      data-source={item.source}
      className="relative"
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="absolute top-6 -left-[1.95rem] size-3 border-2 border-ink bg-brass"
        />
      ) : null}
      <p className="eyebrow mb-2 text-ink-muted">
        <span className="font-bold text-federal-blue">{number(index)}</span> ·
        from {sectionOf(item)}
      </p>
      <BlockView block={item.block} size="full" />
    </li>
  );
}
